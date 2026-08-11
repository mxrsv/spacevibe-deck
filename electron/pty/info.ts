/**
 * `pty_info` — the port of `src-tauri/src/info.rs`.
 *
 * One `ps -A` snapshot answers every pane in the batch, which is the whole
 * reason this is cheap enough to run on a 2 s poll: measured at 69 ms for 717
 * rows, versus one syscall per pane in the Rust version.
 *
 * `cwd` has a PRIMARY source and a fallback, matching Rust: the foreground
 * process's real working directory (one batched `lsof`), falling back to what
 * OSC 9;9 last reported. An earlier version of this file had only the fallback,
 * which meant a stock macOS shell — one that emits no OSC 9;9 at all — showed
 * no cwd anywhere, forever.
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
  cwds: ReadonlyMap<number, string> = new Map(),
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
      // Live cwd first, OSC 9;9 second — `info.rs` orders it the same way.
      cwd: cwds.get(foreground.pid) ?? snapshot.cwd,
      process: foreground.name,
      kind,
      agent,
    };
  });
}

/**
 * Take a fresh reading and classify — the command entry point.
 *
 * REJECTS when the process table cannot be read. Returning all-`unknown`
 * instead would be worse than useless: `unknown` is not `busy`, so a failed
 * reading would silently unblock the quit guard and kill running agents with
 * no prompt. A rejection makes the poller keep its last known values, which is
 * what it is written to do.
 */
export async function ptyInfo(
  snapshots: readonly PtySessionSnapshot[],
): Promise<PtyInfo[]> {
  if (snapshots.length === 0) {
    return [];
  }
  const rows = await platform().readProcessTable();
  // Resolve cwds for the foreground processes only — one `lsof` for the batch.
  const foregroundPids = snapshots.flatMap((snapshot) => {
    const foreground = platform().foregroundProcess(
      rows,
      snapshot.ttyName,
      snapshot.pid,
    );
    return foreground === null ? [] : [foreground.pid];
  });
  const cwds = await platform().processCwds([...new Set(foregroundPids)]);
  return buildPtyInfo(snapshots, rows, cwds);
}
