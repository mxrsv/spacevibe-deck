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
 * 69 ms for 717 rows against a 2 s poll interval.
 */
import { execFile, execFileSync } from "node:child_process";
import os from "node:os";

/** Matches `KILL_GRACE` in macos.rs — SIGHUP, then SIGKILL after this. */
export const KILL_GRACE_MS = 2000;

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

/** Snapshot of the whole process table, taken once per poll tick. */
export function readProcessTable(): PsRow[] {
  try {
    return parsePsTable(
      execFileSync("/bin/ps", ["-A", "-o", "pid=,pgid=,tpgid=,tty=,args="], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 4000,
      }),
    );
  } catch {
    // A failed snapshot means every pane reports Unknown for this tick, which
    // is the honest answer — the previous values stay on screen because the
    // poller keeps last-known on error.
    return [];
  }
}

export interface ForegroundProcess {
  readonly pid: number;
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
  const leader =
    onTty.find((row) => row.pid === target) ??
    onTty.find((row) => row.pgid === target);
  if (leader === undefined) {
    return null;
  }
  return { pid: leader.pid, name: argv0Name(leader.args) };
}

/**
 * Working directory of a pid, via `lsof`.
 *
 * Deliberately OFF the poll path: cwd normally arrives through OSC 9;9 shell
 * integration, exactly as it does on Tauri. This is the fallback for a shell
 * with no integration loaded, and it is slow enough (~20 ms for six pids) that
 * calling it every tick would be a regression.
 */
export function processCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "/usr/sbin/lsof",
      ["-a", "-d", "cwd", "-p", String(pid), "-Fn"],
      { encoding: "utf8", timeout: 4000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const line = stdout
          .split("\n")
          .find((candidate) => candidate.startsWith("n"));
        resolve(line === undefined ? null : line.slice(1) || null);
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
  const foreground =
    foregroundGroup !== null && foregroundGroup > 1 ? foregroundGroup : null;
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
