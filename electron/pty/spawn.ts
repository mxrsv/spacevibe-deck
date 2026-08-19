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

function platform() {
  return process.platform === "win32" ? windows : macos;
}

/**
 * Working directory for a new shell: an existing directory passes through,
 * anything else falls back to the user's home.
 *
 * The fallback is why `dirs_exist` exists on the renderer side — a deleted
 * workspace would otherwise come back as a tab claiming a folder its shells
 * are not actually in.
 */
export function resolveSpawnCwd(cwd: string | null, home: string): string {
  if (cwd !== null && cwd.length > 0) {
    try {
      if (fs.statSync(cwd).isDirectory()) {
        return cwd;
      }
    } catch {
      // Fall through to home.
    }
  }
  return home;
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
 */
export function buildEnv(base: NodeJS.ProcessEnv, version: string): NodeJS.ProcessEnv {
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
  return env;
}

export interface SpawnedShell {
  readonly pty: pty.IPty;
  readonly ttyName: string;
}

/**
 * Spawn a login shell on a new PTY.
 *
 * `encoding: null` is load-bearing: it makes `onData` deliver Buffers so the
 * caller can run its own streaming UTF-8 decoder, keeping a multi-byte
 * sequence that straddles a read boundary intact rather than turning both
 * halves into U+FFFD.
 */
export function spawnShell(options: SpawnOptions): SpawnedShell {
  const launch = platform().shellLaunch();
  const home = platform().userHome();
  const session = pty.spawn(launch.executable, [...launch.args], {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: resolveSpawnCwd(options.cwd, home),
    env: buildEnv(process.env, app.getVersion()) as Record<string, string>,
    encoding: null,
  });
  return { pty: session, ttyName: ptsName(session) };
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
