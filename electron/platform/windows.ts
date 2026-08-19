/**
 * Windows platform seam — the pure-Node port of `src-tauri/src/platform/windows/`.
 *
 * The Rust host answers these questions with Win32 directly: a Job Object with
 * kill-on-close (`job_object.rs`, 428 LOC) and a WMI process snapshot
 * (`process_snapshot.rs`, 682 LOC). Node can reach neither API. What it can
 * reach — `Get-CimInstance Win32_Process`, which is the same WMI class the Rust
 * build queries, and `taskkill /T` — is enough for the same ANSWERS, with one
 * guarantee genuinely lost. Both are named below rather than glossed.
 *
 * **What is faithful.** The snapshot reads the identical WMI fields; the
 * descendant walk, the creation-date filter and the deepest-newest tie-break
 * are ported case for case from `classify_root`/`collect_descendants`; the
 * shell launch reproduces `shell.rs` exactly, including the injected prompt
 * that makes OSC 133 and OSC 9;9 work.
 *
 * **What is lost.** A Job Object kills a whole tree when Deck's own handle
 * closes, so a crash cannot orphan an agent. `taskkill /T` only walks the tree
 * that exists at the moment it runs: if Deck dies, whatever it spawned keeps
 * running. That is a real regression against the Tauri host and the reason the
 * migration spec's abort criterion exists — reopened and accepted by the owner
 * on 2026-08-17 in favour of a pure-Node host.
 *
 * **What is unverified.** All of it. Gate C is still open: no Windows machine
 * has run a line of this. Every function here is written against the Rust
 * implementation and the documented behaviour of the tools it shells out to,
 * and the unit tests below exercise the pure halves only. Do not read a green
 * suite as Windows evidence.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ForegroundProcess, PsRow, ShellLaunch } from "./macos";

/**
 * Grace between the polite terminate and the forced one, matching
 * `KILL_GRACE` on the other host.
 */
export const KILL_GRACE_MS = 500;

/** Pids Windows reserves: 0 is System Idle, 4 is System. */
const LOWEST_KILLABLE_PID = 4;

/** `;` — the Windows PATH separator, named because the host `path` module is
 * POSIX everywhere this file is tested. */
const WINDOWS_PATH_DELIMITER = ";";

/**
 * The prompt function Deck injects, ported verbatim from `shell.rs`.
 *
 * It is the ONLY reason Windows panes have a working directory at all: WMI's
 * `Win32_Process` has no cwd field, and there is no pure-Node equivalent of
 * macOS's `lsof -d cwd`. OSC 9;9 from this prompt is the whole cwd story on
 * this platform, which is also why it wraps rather than replaces the user's own
 * prompt — losing their prompt to gain a cwd would be a bad trade.
 */
export const PROMPT_INTEGRATION = `$Global:__DeckOriginalPrompt = $function:Prompt;
function Global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation;
  $out = "$([char]27)]133;A$([char]7)";
  if ($loc.Provider.Name -eq "FileSystem") {
    $out += "$([char]27)]9;9;\`"$($loc.ProviderPath)\`"$([char]7)";
  }
  if ($null -ne $Global:__DeckOriginalPrompt) {
    $out += $Global:__DeckOriginalPrompt.Invoke();
  } else {
    $out += "PS $loc$('>' * ($nestedPromptLevel + 1)) ";
  }
  $out += "$([char]27)]133;B$([char]7)";
  return $out;
}`;

const POWERSHELL_CANDIDATES = ["pwsh.exe", "powershell.exe"] as const;

/**
 * Where to look for a shell, in order: `PATH` first, then the well-known
 * install location for that specific executable.
 *
 * The fallbacks matter on a default Windows install — `powershell.exe` is
 * reliably on `PATH`, but a PowerShell 7 installed by MSI is not always, and
 * preferring it is the point of the candidate order.
 */
export function executableCandidates(name: string, env: NodeJS.ProcessEnv = process.env): string[] {
  // `path.win32`, not `path`: this module only ever RUNS on Windows but is
  // only ever TESTED on the maintainer's Mac, where the default `path` splits
  // `C:\a;C:\b` on ":" and calls every Windows path relative. On Windows the
  // two are the same object.
  const candidates = (env.PATH ?? env.Path ?? "")
    .split(WINDOWS_PATH_DELIMITER)
    .filter((directory) => directory.length > 0)
    .map((directory) => path.win32.join(directory, name));
  if (name.toLowerCase() === "pwsh.exe" && env.ProgramFiles) {
    candidates.push(path.win32.join(env.ProgramFiles, "PowerShell", "7", name));
  } else if (name.toLowerCase() === "powershell.exe" && env.SystemRoot) {
    candidates.push(path.win32.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", name));
  }
  return candidates;
}

/**
 * The suffixes a Windows command can actually carry, empty string first.
 *
 * Ported from `COMMAND_SUFFIXES` in `agent_discovery.rs`, and the reason it
 * exists is the whole Windows agent-discovery bug: an npm-installed CLI ships
 * as a `.cmd` shim with no bare `.exe` anywhere on PATH, so anything that
 * probes for the bare name — or only appends `.exe` — finds nothing and the
 * picker collapses to "Shell only" as if nothing were installed.
 */
export const COMMAND_SUFFIXES = ["", ".exe", ".cmd", ".bat", ".ps1"] as const;

/**
 * Resolve a command name against PATH, probing every Windows suffix.
 *
 * The Rust twin is `pub(crate)` for the same reason this is exported: editor
 * launching hits the identical gap for `code`/`cursor`, which are also `.cmd`
 * shims.
 */
export function resolveOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = isFile,
): string | null {
  const directories = (env.PATH ?? env.Path ?? "")
    .split(WINDOWS_PATH_DELIMITER)
    .filter((directory) => directory.length > 0 && path.win32.isAbsolute(directory));
  for (const directory of directories) {
    for (const suffix of COMMAND_SUFFIXES) {
      const candidate = path.win32.join(directory, `${name}${suffix}`);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** First existing candidate, or null. Split out so tests can supply their own probe. */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = isFile,
): string | null {
  return (
    executableCandidates(name, env).find(
      (candidate) => path.win32.isAbsolute(candidate) && exists(candidate),
    ) ?? null
  );
}

/**
 * PowerShell 7 if it is installed, Windows PowerShell otherwise.
 *
 * Throws when neither exists, rather than falling back to `cmd.exe`: the
 * prompt integration above is PowerShell, so a `cmd` pane would silently lose
 * its cwd and its prompt-ready signal — a pane that looks fine and quietly
 * reports nothing.
 */
export function buildShellLaunch(
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = isFile,
): ShellLaunch {
  const executable = POWERSHELL_CANDIDATES.map((name) => findExecutable(name, env, exists)).find(
    (found): found is string => found !== null,
  );
  if (executable === undefined) {
    throw new Error(
      "No supported PowerShell executable was found. Install PowerShell 7 or enable Windows PowerShell.",
    );
  }
  return {
    executable,
    args: ["-NoLogo", "-NoExit", "-Command", PROMPT_INTEGRATION],
  };
}

export function shellLaunch(): ShellLaunch {
  return buildShellLaunch();
}

export function userHome(): string {
  const profile = process.env.USERPROFILE ?? os.homedir();
  if (profile.length === 0) {
    throw new Error("The Windows user profile directory is unavailable");
  }
  return profile;
}

/**
 * A row of the Windows process table, shaped so it satisfies the seam's
 * `PsRow` while carrying what Windows actually has.
 *
 * `pgid` holds the PARENT pid, because the parent edge is the only tree link
 * Windows offers and the seam has no field for it. `tpgid` and `tty` are inert:
 * there is no controlling terminal and no foreground process group here, which
 * is exactly why `foregroundProcess` below ignores the tty argument and walks
 * the tree instead.
 */
export interface WindowsProcessRow extends PsRow {
  /** Same value as `pgid`, under the name it actually has. */
  readonly ppid: number;
  /** `ToFileTimeUtc()`; the PID-reuse guard compares these. */
  readonly creationDate: number;
  /** `ExecutablePath` when WMI gives one, else `Name`. */
  readonly executable: string;
}

/**
 * One NDJSON record per process.
 *
 * `ConvertTo-Json -Compress` per record rather than one array: a command line
 * can contain anything, including quotes and newlines, and JSON string
 * escaping is the only quoting here that survives all of it — a CSV column
 * would need a real CSV parser and `wmic`'s output cannot be parsed at all.
 * `wmic` is also removed from current Windows, so CIM is the only door left.
 */
const SNAPSHOT_SCRIPT = [
  "Get-CimInstance -ClassName Win32_Process",
  "-Property ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath,CommandLine",
  "| ForEach-Object {",
  "$c = 0;",
  "if ($_.CreationDate) { $c = $_.CreationDate.ToFileTimeUtc() };",
  "[pscustomobject]@{p=$_.ProcessId;pp=$_.ParentProcessId;c=$c;n=$_.Name;e=$_.ExecutablePath;l=$_.CommandLine}",
  "| ConvertTo-Json -Compress }",
].join(" ");

interface SnapshotRecord {
  readonly p?: unknown;
  readonly pp?: unknown;
  readonly c?: unknown;
  readonly n?: unknown;
  readonly e?: unknown;
  readonly l?: unknown;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parse the NDJSON snapshot. Unreadable lines are skipped rather than thrown,
 * matching the macOS parser: one malformed record must not blind every pane.
 */
export function parseProcessTable(output: string): WindowsProcessRow[] {
  const rows: WindowsProcessRow[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith("{")) {
      continue;
    }
    let record: SnapshotRecord;
    try {
      record = JSON.parse(trimmed) as SnapshotRecord;
    } catch {
      continue;
    }
    const pid = asNumber(record.p);
    if (pid === null) {
      continue;
    }
    const ppid = asNumber(record.pp) ?? 0;
    const executable = asString(record.e) || asString(record.n);
    rows.push({
      pid,
      // The seam's field, carrying the parent pid — see `WindowsProcessRow`.
      pgid: ppid,
      tpgid: -1,
      tty: "",
      args: asString(record.l) || executable,
      ppid,
      creationDate: asNumber(record.c) ?? 0,
      executable,
    });
  }
  return rows;
}

/**
 * Snapshot of the whole process table, through Windows PowerShell.
 *
 * Rejects rather than resolving empty, for the reason `macos.ts` spells out:
 * an empty table classifies every pane `unknown`, `unknown` is not `busy`, and
 * a swallowed failure would silently unblock the quit guard.
 *
 * COST: this forks a PowerShell, which is far heavier than macOS's measured
 * 69 ms `ps`. `-NoProfile` is not a nicety — a user's profile script runs on
 * every poll tick without it. The real figure is unmeasured (Gate C), and if it
 * proves too slow the answer is a longer poll interval, not a silent cache.
 */
export function readProcessTable(): Promise<WindowsProcessRow[]> {
  const shell = findExecutable("powershell.exe") ?? "powershell.exe";
  return new Promise((resolve, reject) => {
    execFile(
      shell,
      ["-NoProfile", "-NonInteractive", "-Command", SNAPSHOT_SCRIPT],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 8000 },
      (error, stdout) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve(parseProcessTable(stdout));
      },
    );
  });
}

interface Descendant {
  readonly row: WindowsProcessRow;
  readonly depth: number;
}

/**
 * Every process below `shellPid`, breadth first.
 *
 * The creation-date filter is the PID-reuse guard from `collect_descendants`:
 * Windows recycles pids aggressively, so a row that is OLDER than the shell
 * cannot be its child no matter what its parent pid says — without this, a
 * recycled pid grafts an unrelated process tree onto a pane and can report a
 * busy agent in an idle shell.
 */
export function collectDescendants(
  rows: readonly WindowsProcessRow[],
  shellPid: number,
): Descendant[] {
  const root = rows.find((row) => row.pid === shellPid);
  if (root === undefined) {
    return [];
  }
  const children = new Map<number, WindowsProcessRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid);
    if (siblings === undefined) {
      children.set(row.ppid, [row]);
    } else {
      siblings.push(row);
    }
  }
  const descendants: Descendant[] = [];
  const visited = new Set<number>([shellPid]);
  const queue: Array<readonly [number, number]> = [[shellPid, 0]];
  while (queue.length > 0) {
    const [parentPid, parentDepth] = queue.shift()!;
    for (const row of children.get(parentPid) ?? []) {
      if (row.creationDate < root.creationDate || visited.has(row.pid)) {
        continue;
      }
      visited.add(row.pid);
      const depth = parentDepth + 1;
      descendants.push({ row, depth });
      queue.push([row.pid, depth]);
    }
  }
  return descendants;
}

/**
 * What is running in a pane, from a table snapshot.
 *
 * `ttyName` is ignored: Windows has no controlling terminal, so the question
 * "what holds the tty" has no answer here and the tree is walked instead. The
 * deepest-then-newest tie-break is `classify_root`'s, and it is what makes
 * `claude` win over the `node.exe` that launched it.
 *
 * No descendants means the shell itself is in front — reported with the
 * shell's own name, which `classifyProcess` resolves to `idle-shell` through
 * its `pwsh`/`powershell` entries.
 */
export function foregroundProcess(
  rows: readonly PsRow[],
  _ttyName: string,
  shellPid: number,
): ForegroundProcess | null {
  const windowsRows = rows.filter(isWindowsRow);
  const shell = windowsRows.find((row) => row.pid === shellPid);
  if (shell === undefined) {
    return null;
  }
  const descendants = collectDescendants(windowsRows, shellPid);
  if (descendants.length === 0) {
    return { pid: shell.pid, group: null, name: processName(shell) };
  }
  const deepest = descendants.reduce((best, candidate) =>
    outranks(candidate, best) ? candidate : best,
  );
  // `group` carries the pid to terminate, not a POSIX group id: `taskkill /T`
  // takes the root of a tree, which is exactly this process.
  return {
    pid: deepest.row.pid,
    group: deepest.row.pid,
    name: processName(deepest.row),
  };
}

/**
 * `(depth, creation_date, process_id)` compared in that order — the tuple
 * `classify_root` maximises over.
 *
 * Compared field by field rather than folded into one number: a FILETIME is
 * ~1.3e17, and any weighting that puts depth above it lands outside a double's
 * 53-bit integer range, where the creation date silently stops counting.
 */
function outranks(candidate: Descendant, best: Descendant): boolean {
  if (candidate.depth !== best.depth) {
    return candidate.depth > best.depth;
  }
  if (candidate.row.creationDate !== best.row.creationDate) {
    return candidate.row.creationDate > best.row.creationDate;
  }
  return candidate.row.pid > best.row.pid;
}

function isWindowsRow(row: PsRow): row is WindowsProcessRow {
  return (
    typeof (row as WindowsProcessRow).creationDate === "number" &&
    typeof (row as WindowsProcessRow).ppid === "number"
  );
}

function processName(row: WindowsProcessRow): string | null {
  const name = row.executable.split(/[/\\]/).pop() ?? "";
  return name.length > 0 ? name : null;
}

/**
 * Working directories — always empty on Windows.
 *
 * `Win32_Process` carries no working directory, and reading another process's
 * PEB is the native call this port exists to avoid. The cwd a Windows pane
 * shows therefore comes entirely from OSC 9;9, emitted by the prompt
 * `shellLaunch` injects; `info.ts` already falls back to it.
 *
 * Consequence worth stating: a pane whose shell has been replaced by something
 * that does not emit OSC 9;9 keeps the last directory it reported, and a pane
 * that never emitted one shows the directory it was spawned in.
 */
export function processCwds(_pids: readonly number[]): Promise<Map<number, string>> {
  return Promise.resolve(new Map());
}

/**
 * Terminate a pane's processes.
 *
 * `taskkill /T` walks the tree Windows knows about at call time — the closest
 * reachable thing to `killpg`. The polite pass first so a TUI can save; the
 * forced pass after the grace window; the shell forced outright, as on macOS.
 *
 * The pid guards are not ceremony: `taskkill /PID 4 /F` targets the System
 * process, and passing Deck's own pid would kill the app instead of the pane.
 */
export function terminateProcessGroups(
  foregroundGroup: number | null,
  shellGroup: number | null,
  graceMs: number = KILL_GRACE_MS,
): void {
  const foreground = killablePid(foregroundGroup);
  const shell = killablePid(shellGroup);

  if (foreground !== null) {
    taskkill(foreground, false);
    const timer = setTimeout(() => taskkill(foreground, true), graceMs);
    timer.unref?.();
  }
  if (shell !== null) {
    taskkill(shell, true);
  }
}

/**
 * The pid `taskkill` may be pointed at, or null.
 *
 * Exported because it is the whole safety argument for this file: everything
 * else here reports, this one destroys.
 */
export function killablePid(pid: number | null, selfPid: number = process.pid): number | null {
  if (pid === null || !Number.isInteger(pid) || pid <= LOWEST_KILLABLE_PID) {
    return null;
  }
  return pid === selfPid ? null : pid;
}

function taskkill(pid: number, force: boolean): void {
  const args = ["/PID", String(pid), "/T"];
  if (force) {
    args.push("/F");
  }
  execFile("taskkill", args, { timeout: 4000, windowsHide: true }, () => {
    // A non-zero exit means the process was already gone, which is the
    // outcome we wanted. Nothing here can act on the difference.
  });
}
