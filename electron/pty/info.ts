/**
 * `pty_info` — the port of `src-tauri/src/info.rs`.
 *
 * One `ps -A` snapshot answers every pane in the batch, which is the whole
 * reason this is cheap enough to run on a 2 s poll: measured at 69 ms for 717
 * rows, versus one syscall per pane in the Rust version.
 *
 * `cwd` comes from OSC 9;9 shell integration, exactly as on Tauri. The `lsof`
 * fallback in the platform module is deliberately NOT called from here — it
 * costs ~20 ms for six pids and would turn a cheap poll into an expensive one
 * for information the shell already volunteers.
 */
import { classifyProcess, type Classification } from "../platform/classify";
import * as macos from "../platform/macos";
import * as windows from "../platform/windows";
import type { PtySessionSnapshot } from "./session-store";

function platform() {
  return process.platform === "win32" ? windows : macos;
}

export interface PtyInfo {
  readonly id: number;
  readonly cwd: string | null;
  readonly process: string | null;
  readonly kind: Classification["kind"];
  readonly agent: Classification["agent"];
}

function unknownInfo(snapshot: PtySessionSnapshot): PtyInfo {
  return {
    id: snapshot.id,
    cwd: snapshot.cwd,
    process: null,
    kind: "unknown",
    agent: null,
  };
}

/**
 * Classify each snapshot against one process-table reading.
 *
 * A pane whose tty is absent from the table reports `unknown` rather than a
 * guess: `busy` is what blocks a quit, so inventing it would be worse than
 * admitting ignorance.
 */
export function buildPtyInfo(
  snapshots: readonly PtySessionSnapshot[],
  rows: readonly macos.PsRow[],
): PtyInfo[] {
  return snapshots.map((snapshot) => {
    const foreground = platform().foregroundProcess(
      rows,
      snapshot.ttyName,
      snapshot.pid,
    );
    if (foreground === null) {
      return unknownInfo(snapshot);
    }
    const { kind, agent } = classifyProcess(foreground.name, true);
    return {
      id: snapshot.id,
      cwd: snapshot.cwd,
      process: foreground.name,
      kind,
      agent,
    };
  });
}

/** Take a fresh snapshot and classify — the command entry point. */
export function ptyInfo(snapshots: readonly PtySessionSnapshot[]): PtyInfo[] {
  if (snapshots.length === 0) {
    return [];
  }
  return buildPtyInfo(snapshots, platform().readProcessTable());
}
