/**
 * macOS platform seam — the Node counterpart of `src-tauri/src/platform/macos.rs`.
 *
 * Two jobs: describe how to launch a login shell, and classify what is running
 * in a pane. The second one is where this port genuinely differs from Rust,
 * and the reason is measured rather than assumed:
 *
 * `node-pty`'s `.process` getter reads `p_comm` for the foreground pgid, which
 * is truncated to 16 characters and is not argv0. Probed on 2026-08-11 it
 * returned `"2.1.227"` for a real `claude` pane — the CLI's version banner —
 * and the executable name instead of argv0 for a renamed job. Deck classifies
 * panes by argv0 (that is why the Rust version reads `KERN_PROCARGS2` rather
 * than `p_comm`), so trusting `.process` would label every agent pane `Busy`
 * and silently break the agent chip, the dot colour and attention state.
 *
 * So: one `ps -A` per poll tick, joined by tty → tpgid → pgid. Measured at
 * 69 ms for 717 rows against a 2 s poll interval — run ASYNCHRONOUSLY, because
 * this is the process that pumps every pane's output.
 */
import { execFile } from "node:child_process";
import os from "node:os";

/** SIGHUP, then SIGKILL after this. 500 ms, matching `KILL_GRACE` in
 * macos.rs — an earlier value of 2000 ms let a SIGHUP-ignoring TUI outlive its
 * closed pane four times longer than on Tauri. */
export const KILL_GRACE_MS = 500;

export interface ShellLaunch {
  readonly executable: string;
  readonly args: readonly string[];
}

/** `$SHELL -l`, falling back to zsh. A LOGIN shell: PATH, aliases and dotfiles
 * are a public promise on the landing page, not an implementation detail. */
export function shellLaunch(): ShellLaunch {
  return { executable: process.env.SHELL || "/bin/zsh", args: ["-l"] };
}

export function userHome(): string {
  return os.homedir();
}

export interface PsRow {
  readonly pid: number;
  readonly pgid: number;
  readonly tpgid: number;
  readonly tty: string;
  readonly args: string;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(.*)$/;

/** Parse `ps -A -o pid=,pgid=,tpgid=,tty=,args=` output. Unparseable lines are
 * skipped rather than throwing — a malformed row must not blind every pane. */
export function parsePsTable(output: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of output.split("\n")) {
    const match = PS_LINE.exec(line);
    if (match === null) {
      continue;
    }
    rows.push({
      pid: Number(match[1]),
      pgid: Number(match[2]),
      tpgid: Number(match[3]),
      tty: match[4],
      args: match[5],
    });
  }
  return rows;
}

/**
 * Basename of argv0 with any leading dashes stripped.
 *
 * The dash strip is not cosmetic: a login shell presents itself as `-zsh`, and
 * without this every idle pane would classify as `Busy` instead of `IdleShell`.
 * Mirrors `argv0_name` in macos.rs, which has a dedicated Rust test for it.
 */
export function argv0Name(args: string): string | null {
  const argv0 = args.trim().split(/\s+/)[0] ?? "";
  const basename = argv0.split("/").pop() ?? "";
  const stripped = basename.replace(/^-+/, "");
  return stripped.length > 0 ? stripped : null;
}

/**
 * Snapshot of the whole process table.
 *
 * ASYNCHRONOUS on purpose. The synchronous version blocked the main process
 * for a measured 72-75 ms per call, and the renderer polls every 2 s PER
 * WINDOW — during which no PTY byte reaches any renderer and no IPC is
 * serviced. This is the process that pumps every pane's output; it must not
 * fork-and-wait.
 *
 * Rejects rather than returning `[]` on failure. An empty table classifies
 * every pane `unknown`, and `unknown` is not `busy`, so a swallowed failure
 * silently unblocks the quit guard and kills running agents without a prompt.
 * The caller must decide what a failed reading means.
 */
export function readProcessTable(): Promise<PsRow[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/ps",
      ["-A", "-o", "pid=,pgid=,tpgid=,tty=,args="],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 4000 },
      (error, stdout) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve(parsePsTable(stdout));
      },
    );
  });
}

export interface ForegroundProcess {
  /** The process to inspect — the group leader where one exists. */
  readonly pid: number;
  /**
   * The foreground PROCESS GROUP id, or null when it cannot be established.
   *
   * Distinct from `pid` on purpose: `terminateProcessGroups` calls
   * `kill(-group)`, and passing a group MEMBER's pid there signals a group
   * that does not exist. The result is an under-kill — the foreground job
   * survives the pane that owned it.
   */
  readonly group: number | null;
  /** argv0 basename — what Deck classifies on. */
  readonly name: string | null;
}

/**
 * The foreground job on `ttyName`, from a table snapshot.
 *
 * Rust asks the PTY master for the foreground pgid via `tcgetpgrp`; Node has no
 * binding for that, so the same answer is read out of `ps`: find the shell's
 * row on this tty, take its `tpgid`, then find the process group leader with
 * that pgid. A tty missing from the table yields null, which the caller turns
 * into `Unknown` rather than a guess.
 */
export function foregroundProcess(
  rows: readonly PsRow[],
  ttyName: string,
  shellPid: number,
): ForegroundProcess | null {
  const onTty = rows.filter((row) => row.tty === ttyName);
  const shellRow = onTty.find((row) => row.pid === shellPid);
  if (shellRow === undefined) {
    return null;
  }
  const target = shellRow.tpgid > 0 ? shellRow.tpgid : shellRow.pgid;
  const leader = onTty.find((row) => row.pid === target);
  if (leader !== undefined) {
    // The leader's pid IS the group id, which is what killpg needs.
    return { pid: leader.pid, group: leader.pid, name: argv0Name(leader.args) };
  }
  // Leader reaped, members still holding the tty. Classify from a member so
  // the pane does not fall to `unknown`, but report NO group: a member's pid
  // is not a group id, and signalling it would hit nothing (or, in principle,
  // something else).
  const member = onTty.find((row) => row.pgid === target);
  if (member === undefined) {
    return null;
  }
  return { pid: member.pid, group: null, name: argv0Name(member.args) };
}

/**
 * Working directories for several pids at once, via one `lsof`.
 *
 * This is the PRIMARY cwd source, matching Rust: `info.rs` reads the
 * foreground process's cwd with `proc_pidinfo(PROC_PIDVNODEPATHINFO)` and
 * treats OSC 9;9 only as a fallback. An earlier version of this port had no
 * primary source at all, so on a stock shell — which emits no OSC 9;9, because
 * Deck injects no rc hook on macOS — the pane cwd was permanently empty: no
 * cwd in the header, no git branch, copy-cwd a no-op, and every new tab or
 * restored layout opening in `$HOME`.
 *
 * Batched because per-pid costs ~62 ms while six pids together cost ~34 ms.
 * A failure resolves to an empty map rather than rejecting: a missing cwd is a
 * cosmetic degradation and must never take the poll down with it.
 */
export function processCwds(pids: readonly number[]): Promise<Map<number, string>> {
  if (pids.length === 0) {
    return Promise.resolve(new Map());
  }
  return new Promise((resolve) => {
    execFile(
      "/usr/sbin/lsof",
      ["-a", "-d", "cwd", "-p", pids.join(","), "-Fn"],
      { encoding: "utf8", timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
      (_error, stdout) => {
        // `-F` output is one field per line: `p<pid>` opens a process block,
        // `n<path>` gives the name. A partial failure still prints the pids it
        // could read, so parse whatever came back.
        const cwds = new Map<number, string>();
        let current: number | null = null;
        for (const line of String(stdout ?? "").split("\n")) {
          if (line.startsWith("p")) {
            const pid = Number(line.slice(1));
            current = Number.isInteger(pid) ? pid : null;
          } else if (line.startsWith("n") && current !== null) {
            const path = line.slice(1);
            if (path.length > 0 && !cwds.has(current)) {
              cwds.set(current, path);
            }
          }
        }
        resolve(cwds);
      },
    );
  });
}

/**
 * Terminate a pane's processes — the port of `terminate_process_groups`.
 *
 * SIGHUP to the foreground group first so a TUI can clean up, SIGKILL after the
 * grace window, and SIGKILL straight to the shell's own group. Groups at or
 * below 1 are refused: `killpg(0)` would signal Deck's own process group and
 * `killpg(1)` targets init.
 */
export function terminateProcessGroups(
  foregroundGroup: number | null,
  shellGroup: number | null,
  graceMs: number = KILL_GRACE_MS,
): void {
  const foreground = foregroundGroup !== null && foregroundGroup > 1 ? foregroundGroup : null;
  const shell = shellGroup !== null && shellGroup > 1 ? shellGroup : null;

  if (foreground !== null) {
    killGroup(foreground, "SIGHUP");
    const timer = setTimeout(() => killGroup(foreground, "SIGKILL"), graceMs);
    // Do not hold the event loop open just to deliver a follow-up SIGKILL —
    // quitting the app already tears the process group down.
    timer.unref?.();
  }
  if (shell !== null) {
    killGroup(shell, "SIGKILL");
  }
}

function killGroup(processGroup: number, signal: NodeJS.Signals): void {
  try {
    // A negative pid targets the whole process group — the killpg equivalent.
    process.kill(-processGroup, signal);
  } catch {
    // ESRCH means it already exited, which is the outcome we wanted.
  }
}
