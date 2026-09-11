/**
 * Shell spawning — the port of `spawn_shell` in `src-tauri/src/pty.rs`.
 *
 * The env block below is copied deliberately, not approximated. Each entry has
 * a reason recorded in the Rust source and repeated here, because losing one
 * of them breaks something a user can see while leaving the pane looking fine.
 */
import fs from "node:fs";
import path from "node:path";
import * as pty from "node-pty";
import { app } from "electron";
import * as macos from "../platform/macos";
import * as windows from "../platform/windows";

export interface SpawnOptions {
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string | null;
}

export interface ResizeOptions {
  readonly id: number;
  readonly cols: number;
  readonly rows: number;
}

/** ConPTY ultimately stores both dimensions in signed 16-bit coordinates. */
export const MAX_PTY_DIMENSION = 32_767;

function validateDimension(value: unknown, field: "cols" | "rows", command: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_PTY_DIMENSION
  ) {
    throw new TypeError(`Invalid ${command} ${field}.`);
  }
  return value;
}

/** Validate the renderer payload before it reaches the PTY boundary. */
export function validateSpawnOptions(payload: unknown): SpawnOptions {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Invalid spawn_shell payload.");
  }
  const { cols, rows, cwd } = payload as Record<string, unknown>;
  const validCols = validateDimension(cols, "cols", "spawn_shell");
  const validRows = validateDimension(rows, "rows", "spawn_shell");
  if (typeof cwd !== "string" && cwd !== null) {
    throw new TypeError("Invalid spawn_shell cwd.");
  }
  return { cols: validCols, rows: validRows, cwd };
}

/** Validate resize IPC before native geometry conversion. */
export function validateResizeOptions(payload: unknown): ResizeOptions {
  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Invalid resize_pty payload.");
  }
  const { id, cols, rows } = payload as Record<string, unknown>;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("Invalid resize_pty id.");
  }
  return {
    id,
    cols: validateDimension(cols, "cols", "resize_pty"),
    rows: validateDimension(rows, "rows", "resize_pty"),
  };
}

function platform() {
  return process.platform === "win32" ? windows : macos;
}

/**
 * Working directory for a new shell. `null` is the sole request for Home; an
 * explicit path must resolve to the exact live directory the renderer named.
 * Failing closed here is the last defense against a stale workspace becoming
 * a tab that claims one folder while its shell actually runs in Home.
 */
export function resolveSpawnCwd(cwd: string | null, home: string): string {
  if (cwd === null) {
    return home;
  }
  if (cwd.length === 0) {
    throw new Error("The requested working directory is empty.");
  }
  try {
    if (fs.statSync(cwd).isDirectory()) {
      return cwd;
    }
  } catch (cause) {
    throw new Error(`The requested working directory is unavailable: ${cwd}`, { cause });
  }
  throw new Error(`The requested working directory is not a directory: ${cwd}`);
}

/**
 * Environment for a pane's shell.
 *
 * - `TERM` / `COLORTERM`: baseline capability advertising.
 * - `TERM_PROGRAM=SpaceVibeDeck`: Deck's own identity, deliberately with no
 *   space — every terminal in the wild ships a single token here
 *   (`iTerm.app`, `Apple_Terminal`, `ghostty`) and naive parsers split on
 *   whitespace.
 * - `ConEmuANSI=ON`, **macOS only**: Deck consumes OSC 9;4 progress reports
 *   for the sidebar spinner, but Claude Code only emits them when it
 *   recognizes the terminal — its gate checks ConEmu* vars or a known
 *   TERM_PROGRAM. This is the smallest such capability flag, and ConEmu is
 *   Windows-only so no macOS tool changes behaviour on it. On a real Windows
 *   build it must NOT be faked: tools would pick ConEmu-specific paths on a
 *   plain ConPTY. Verified empirically on Tauri — without it claude emits zero
 *   OSC 9;4; with it, state 0 at startup, 3 while working, 0 when done.
 * - `DECK_PANE_ID` / `DECK_HOOK_TOKEN` / `DECK_HOOK_PORT` (agent-signal
 *   contract layer, stage 2): the pane's identity for the hook script Deck
 *   launches Claude with. The env is fixed at shell spawn while the pane's
 *   OCCUPANT changes, which is why the endpoint generation-checks every post
 *   by session id rather than trusting the pane id alone. The port is omitted
 *   when the loopback listener never bound, and the script exits 0 without
 *   posting when any of the three is missing.
 */
export interface PaneEnv {
  readonly paneId: number;
  /** Per-pane random token; the endpoint refuses a post without it. */
  readonly hookToken: string;
  /** The hook endpoint's port, or null when it could not listen. */
  readonly hookPort: number | null;
  /** Identifies this installation's guarded global hook, including for manual launches. */
  readonly hookScript?: string | null;
}

export function buildEnv(
  base: NodeJS.ProcessEnv,
  version: string,
  pane?: PaneEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "SpaceVibeDeck",
    TERM_PROGRAM_VERSION: version,
  };
  if (process.platform === "darwin") {
    env.ConEmuANSI = "ON";
  }
  if (pane !== undefined) {
    env.DECK_PANE_ID = String(pane.paneId);
    env.DECK_HOOK_TOKEN = pane.hookToken;
    if (pane.hookScript) {
      env.DECK_CLAUDE_HOOK_SCRIPT = pane.hookScript;
    } else {
      delete env.DECK_CLAUDE_HOOK_SCRIPT;
    }
    if (pane.hookPort !== null) {
      env.DECK_HOOK_PORT = String(pane.hookPort);
    } else {
      delete env.DECK_HOOK_PORT;
    }
  }
  return env;
}

export interface SpawnedShell {
  readonly pty: pty.IPty;
  readonly ttyName: string;
  readonly startupTiming: {
    readonly startedAt: number;
    readonly shellResolvedAt: number;
    readonly cwdResolvedAt: number;
    readonly ptyCreatedAt: number;
  };
}

/**
 * Spawn a login shell on a new PTY.
 *
 * `encoding: null` is load-bearing: it makes `onData` deliver Buffers so the
 * caller can run its own streaming UTF-8 decoder, keeping a multi-byte
 * sequence that straddles a read boundary intact rather than turning both
 * halves into U+FFFD.
 */
export function spawnShell(options: SpawnOptions, pane?: PaneEnv): SpawnedShell {
  const startedAt = performance.now();
  const launch = platform().shellLaunch();
  const shellResolvedAt = performance.now();
  const home = platform().userHome();
  const cwd = resolveSpawnCwd(options.cwd, home);
  const cwdResolvedAt = performance.now();
  const session = pty.spawn(launch.executable, [...launch.args], {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd,
    env: buildEnv(process.env, app.getVersion(), pane) as Record<string, string>,
    encoding: null,
  });
  return {
    pty: session,
    ttyName: ptsName(session),
    startupTiming: {
      startedAt,
      shellResolvedAt,
      cwdResolvedAt,
      ptyCreatedAt: performance.now(),
    },
  };
}

/**
 * The pane's tty, without `/dev/`.
 *
 * This is the join key for the `ps` snapshot that classifies panes, so a
 * session without one can never be classified — the caller degrades it to
 * `unknown` instead of guessing.
 */
function ptsName(session: pty.IPty): string {
  const raw = (session as unknown as { ptsName?: string }).ptsName ?? "";
  return raw.startsWith("/dev/") ? raw.slice("/dev/".length) : raw;
}

/** Absolute path of a workspace folder, for the tab title. Kept here so the
 * spawn path owns every filesystem question about a pane's directory. */
export function displayName(directory: string): string {
  return path.basename(directory) || directory;
}
