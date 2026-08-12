/**
 * `pty_info` — the port of `src-tauri/src/info.rs`.
 *
 * One `ps -A` snapshot answers every pane in the batch, which is the whole
 * reason this is cheap enough to run on a 2 s poll: measured at 69 ms for 717
 * rows, versus one syscall per pane in the Rust version.
 *
 * Process classification never waits for cwd discovery. The foreground
 * process's real working directory is refreshed in the background with one
 * batched `lsof`; a matching cached result wins, then OSC 9;9 is the fallback.
 * Keeping these clocks separate prevents cosmetic cwd latency from stalling
 * the agent chip, attention state and quit census.
 */
import {
  classifyProcess,
  type AgentProcessMatcher,
  type Classification,
} from "../platform/classify";
import * as macos from "../platform/macos";
import * as windows from "../platform/windows";
import type { PtySessionSnapshot } from "./session-store";

export interface PtyInfoPlatform {
  readProcessTable(): Promise<macos.PsRow[]>;
  foregroundProcess(
    rows: readonly macos.PsRow[],
    ttyName: string,
    shellPid: number,
  ): macos.ForegroundProcess | null;
  processCwds(pids: readonly number[]): Promise<Map<number, string>>;
}

function platform(): PtyInfoPlatform {
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
  processPlatform: PtyInfoPlatform = platform(),
  agentMatchers: readonly AgentProcessMatcher[] = [],
): PtyInfo[] {
  return snapshots.map((snapshot) => {
    const foreground = processPlatform.foregroundProcess(
      rows,
      snapshot.ttyName,
      snapshot.pid,
    );
    if (foreground === null) {
      return unknownInfo(snapshot);
    }
    const commandLine =
      rows.find((row) => row.pid === foreground.pid)?.args ??
      foreground.name ??
      "";
    const { kind, agent } = classifyProcess(
      foreground.name,
      true,
      commandLine,
      agentMatchers,
    );
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

interface CachedCwd {
  readonly foregroundPid: number;
  readonly cwd: string;
}

export interface PtyInfoReader {
  read(
    snapshots: readonly PtySessionSnapshot[],
    agentMatchers?: readonly AgentProcessMatcher[],
    waitForCwd?: boolean,
  ): Promise<PtyInfo[]>;
}

/**
 * Stateful reader so cwd discovery can lag behind process classification
 * without losing the last verified directory for the same foreground pid.
 */
export function createPtyInfoReader(
  getPlatform: () => PtyInfoPlatform = platform,
): PtyInfoReader {
  const cwdByPane = new Map<number, CachedCwd>();
  let pendingCwdTargets = new Map<number, number>();
  let cwdRefresh: Promise<void> | null = null;
  let processTableRead: Promise<macos.PsRow[]> | null = null;

  function readSharedProcessTable(
    processPlatform: PtyInfoPlatform,
  ): Promise<macos.PsRow[]> {
    if (processTableRead !== null) {
      return processTableRead;
    }
    let reading: Promise<macos.PsRow[]>;
    try {
      reading = Promise.resolve(processPlatform.readProcessTable());
    } catch (error) {
      reading = Promise.reject(error);
    }
    const current = reading.finally(() => {
      if (processTableRead === current) {
        processTableRead = null;
      }
    });
    processTableRead = current;
    return current;
  }

  function scheduleCwdRefresh(processPlatform: PtyInfoPlatform): void {
    if (cwdRefresh !== null || pendingCwdTargets.size === 0) {
      return;
    }
    const refresh = async (): Promise<void> => {
      while (pendingCwdTargets.size > 0) {
        const targets = pendingCwdTargets;
        pendingCwdTargets = new Map();
        const pids = [...new Set(targets.values())];
        const cwds = await processPlatform.processCwds(pids);
        for (const [paneId, foregroundPid] of targets) {
          const cwd = cwds.get(foregroundPid);
          if (cwd !== undefined) {
            cwdByPane.set(paneId, { foregroundPid, cwd });
          }
        }
      }
    };
    const current = refresh()
      .catch((error) => {
        console.warn("Deck: cwd refresh failed", error);
      })
      .finally(() => {
        if (cwdRefresh === current) {
          cwdRefresh = null;
        }
        scheduleCwdRefresh(processPlatform);
      });
    cwdRefresh = current;
  }

  return {
    async read(snapshots, agentMatchers = [], waitForCwd = false) {
      if (snapshots.length === 0) {
        return [];
      }
      const processPlatform = getPlatform();
      const rows = await readSharedProcessTable(processPlatform);
      const cachedCwds = new Map<number, string>();
      const foregroundTargets = new Map<number, number>();
      for (const snapshot of snapshots) {
        const foreground = processPlatform.foregroundProcess(
          rows,
          snapshot.ttyName,
          snapshot.pid,
        );
        if (foreground === null) {
          continue;
        }
        foregroundTargets.set(snapshot.id, foreground.pid);
        const cached = cwdByPane.get(snapshot.id);
        if (cached?.foregroundPid === foreground.pid) {
          cachedCwds.set(foreground.pid, cached.cwd);
        }
      }
      if (waitForCwd) {
        const liveCwds = await processPlatform.processCwds([
          ...new Set(foregroundTargets.values()),
        ]);
        for (const [paneId, foregroundPid] of foregroundTargets) {
          const cwd = liveCwds.get(foregroundPid);
          if (cwd !== undefined) {
            cwdByPane.set(paneId, { foregroundPid, cwd });
            cachedCwds.set(foregroundPid, cwd);
          }
        }
      } else {
        for (const [paneId, foregroundPid] of foregroundTargets) {
          pendingCwdTargets.set(paneId, foregroundPid);
        }
        scheduleCwdRefresh(processPlatform);
      }
      return buildPtyInfo(
        snapshots,
        rows,
        cachedCwds,
        processPlatform,
        agentMatchers,
      );
    },
  };
}

const defaultReader = createPtyInfoReader();

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
  agentMatchers: readonly AgentProcessMatcher[] = [],
  waitForCwd: boolean = false,
): Promise<PtyInfo[]> {
  return defaultReader.read(snapshots, agentMatchers, waitForCwd);
}
