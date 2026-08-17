/**
 * Agent discovery — the port of `src-tauri/src/agents.rs`.
 *
 * Resolves the allowlist through the user's INTERACTIVE LOGIN shell, which is
 * the same shell a real pane runs. The `-i` is load-bearing: CLIs like
 * `claude` register their PATH in `.zshrc`/`.bashrc`, which a non-interactive
 * shell (`-lc`) never sources. In a packaged app the GUI process inherits only
 * a bare PATH from launchd, so a non-interactive probe finds nothing and the
 * picker collapses to Shell only — while a dev run launched from a terminal
 * inherits the terminal's PATH and hides the bug.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import * as macos from "./platform/macos";
import * as windows from "./platform/windows";

/** A login shell that hangs (a `.zprofile` waiting on the network) must not
 * wedge the picker forever — degrade to empty after this. */
export const DETECT_TIMEOUT_MS = 3000;

export interface AgentInfo {
  readonly name: string;
  readonly path: string;
}

/** Recognised out of the box; always probed, whatever the caller asks for.
 * Mirrors `BUILTIN_AGENTS` in `src/lib/agent-catalog.ts`. */
export const BUILTIN_AGENTS = [
  "claude",
  "codex",
  "opencode",
  "agy",
  "gemini",
] as const;

/** Upper bound on a probed name; mirrors `PROBE_NAME_MAX` in agent-catalog.ts. */
const PROBE_NAME_MAX = 128;

const PROBE_SAFE = /^[A-Za-z0-9._~+/-]+$/;

/**
 * Whether a name may be interpolated into the discovery probe.
 *
 * This is a SECURITY BOUNDARY, not a tidiness check. Discovery builds
 * `command -v <name>` strings and runs them through `sh -ilc`, so a name
 * carrying `;`, `&`, `|`, `$`, a backtick, a quote or whitespace would
 * execute. The renderer validates too; this exists because the renderer is not
 * the trust boundary — the request arrives over IPC and any page bug or future
 * caller lands here first.
 */
export function isProbeSafe(name: string): boolean {
  return (
    name.length > 0 && name.length <= PROBE_NAME_MAX && PROBE_SAFE.test(name)
  );
}

/** Every built-in, then each safe caller-supplied name not already present.
 * Built-ins are unconditional so a renderer bug can never collapse the picker
 * to Shell only. */
export function probeNames(requested: readonly string[]): string[] {
  const names: string[] = [...BUILTIN_AGENTS];
  for (const name of requested) {
    if (isProbeSafe(name) && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/** The basename a probed name resolves to. A declared agent may be a path
 * (`~/bin/agent.sh`) while `command -v` answers with a resolved absolute path,
 * so both sides are compared by their last segment. */
export function probeKey(name: string): string {
  return name.split(/[/\\]/).pop() ?? name;
}

/**
 * Strip terminal control sequences from one line.
 *
 * An interactive login shell runs rc-file hooks that print terminal noise with
 * no trailing newline — iTerm shell-integration OSC sequences, powerlevel10k
 * CSI colour codes — so that noise prefixes the first real output line and
 * hides the `command -v` path behind it.
 */
export function stripAnsi(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0x1b) {
      out.push(bytes[i]);
      i += 1;
      continue;
    }
    const next = bytes[i + 1];
    if (next === 0x5b) {
      // CSI: parameters until a final byte in 0x40..=0x7E.
      i += 2;
      while (i < bytes.length && !(bytes[i] >= 0x40 && bytes[i] <= 0x7e)) {
        i += 1;
      }
      i += 1;
    } else if (next === 0x5d) {
      // OSC: string until BEL or ST (ESC \).
      i += 2;
      while (i < bytes.length) {
        if (bytes[i] === 0x07) {
          i += 1;
          break;
        }
        if (bytes[i] === 0x1b && bytes[i + 1] === 0x5c) {
          i += 2;
          break;
        }
        i += 1;
      }
    } else if (next !== undefined) {
      // Any other two-byte escape (charset select, etc.): drop both bytes.
      i += 2;
    } else {
      // Trailing lone ESC at end of line.
      i += 1;
    }
  }
  return Buffer.from(out).toString("utf8");
}

/**
 * Keep only absolute paths whose basename was asked for; first hit per name
 * wins, ordered by first appearance so numbering in the picker stays stable.
 */
export function parseCommandVOutput(
  output: string,
  probed: readonly string[],
): AgentInfo[] {
  const wanted = new Set(probed.map(probeKey));
  const found: AgentInfo[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const candidate = stripAnsi(line).trim();
    if (!candidate.startsWith("/")) {
      continue;
    }
    const name = candidate.split("/").pop();
    if (name === undefined || name.length === 0) {
      continue;
    }
    if (wanted.has(name) && !seen.has(name)) {
      seen.add(name);
      found.push({ name, path: candidate });
    }
  }
  return found;
}

/**
 * Windows discovery: walk PATH directly, no shell.
 *
 * There is no `-ilc` here and no rc file to source — a PowerShell profile is
 * not where a CLI registers its PATH — so the shell probe is not merely
 * unnecessary, it is wrong twice over. This module used to run it
 * unconditionally through the macOS launcher, which ENOENTs on Windows;
 * `detectAgentsSafely` swallowed that to `[]`, and the picker reported "Shell
 * only" on a machine with every agent installed.
 *
 * Each name resolves through `COMMAND_SUFFIXES`, so an npm `.cmd` shim with no
 * bare `.exe` is found. `name` carries the probe key rather than the file's
 * basename: what the renderer stores is `claude`, never `claude.cmd`.
 */
export function discoverAgentsWindows(
  requested: readonly string[],
  resolve: (name: string) => string | null = (name) =>
    windows.resolveOnPath(name),
): AgentInfo[] {
  const found: AgentInfo[] = [];
  const seen = new Set<string>();
  for (const name of probeNames(requested)) {
    const key = probeKey(name);
    if (seen.has(key)) {
      continue;
    }
    const path = resolve(name);
    if (path !== null) {
      seen.add(key);
      found.push({ name: key, path });
    }
  }
  return found;
}

/**
 * Probe the login shell. Any failure — spawn error, or an rc file still
 * hanging past the timeout — degrades to an empty list rather than leaving the
 * picker waiting forever.
 */
export function discoverAgents(
  requested: readonly string[],
): Promise<AgentInfo[]> {
  if (process.platform === "win32") {
    return Promise.resolve(discoverAgentsWindows(requested));
  }
  const names = probeNames(requested);
  const script = names.map((name) => `command -v ${name}`).join("; ");
  const launch = macos.shellLaunch();
  return new Promise((resolve) => {
    execFile(
      launch.executable,
      ["-ilc", script],
      { encoding: "utf8", timeout: DETECT_TIMEOUT_MS, env: process.env },
      (_error, stdout) => {
        resolve(parseCommandVOutput(String(stdout ?? ""), names));
      },
    );
  });
}

/** Existence check for workspace recents; order mirrors input. */
export async function dirsExist(paths: readonly string[]): Promise<boolean[]> {
  return Promise.all(
    paths.map(async (candidate) => {
      try {
        return (await fs.stat(candidate)).isDirectory();
      } catch {
        return false;
      }
    }),
  );
}

/**
 * IPC entry point. Never rejects: the picker must degrade to "Shell only"
 * rather than surface an error, which is what the Rust command did by
 * returning an empty vector on every failure path.
 */
export async function detectAgentsSafely(
  names: readonly string[],
): Promise<AgentInfo[]> {
  try {
    return await discoverAgents(names);
  } catch {
    return [];
  }
}
