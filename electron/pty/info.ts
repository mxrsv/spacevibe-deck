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
  normalizedProcessName,
  type AgentProcessMatcher,
  type Classification,
} from "../platform/classify";
import * as macos from "../platform/macos";
import * as windows from "../platform/windows";
import { processCodexSessions } from "../platform/codex-thread-locks";
import type { PtySessionSnapshot } from "./session-store";

export interface PtyInfoPlatform {
  readProcessTable(): Promise<macos.PsRow[]>;
  /** `prefer` matters only to the Windows tree walk; macOS asks the tty. */
  foregroundProcess(
    rows: readonly macos.PsRow[],
    ttyName: string,
    shellPid: number,
    prefer?: (name: string | null, commandLine: string) => boolean,
  ): macos.ForegroundProcess | null;
  processCwds(pids: readonly number[]): Promise<Map<number, string>>;
}

function platform(): PtyInfoPlatform {
  return process.platform === "win32" ? windows : macos;
}

/**
 * The pane's foreground process, preferring one that classifies as an agent.
 *
 * Both readings go through here: the reader keys its cwd cache on the pid it
 * picks, so a second walk with another rule would never find the cwd.
 */
function foregroundOf(
  processPlatform: PtyInfoPlatform,
  rows: readonly macos.PsRow[],
  snapshot: PtySessionSnapshot,
  agentMatchers: readonly AgentProcessMatcher[],
): macos.ForegroundProcess | null {
  return processPlatform.foregroundProcess(
    rows,
    snapshot.ttyName,
    snapshot.pid,
    (name, commandLine) => classifyProcess(name, true, commandLine, agentMatchers).kind === "agent",
  );
}

export interface PtyInfo {
  readonly id: number;
  readonly processId: number | null;
  readonly codexSessionId?: string | null;
  readonly cwd: string | null;
  readonly process: string | null;
  readonly kind: Classification["kind"];
  readonly agent: Classification["agent"];
}

function unknownInfo(snapshot: PtySessionSnapshot): PtyInfo {
  return {
    id: snapshot.id,
    processId: null,
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
    const foreground = foregroundOf(processPlatform, rows, snapshot, agentMatchers);
    if (foreground === null) {
      return unknownInfo(snapshot);
    }
    const commandLine =
      rows.find((row) => row.pid === foreground.pid)?.args ?? foreground.name ?? "";
    const { kind, agent } = classifyProcess(
      foreground.name,
      true,
      commandLine,
      agentMatchers,
      foreground.pid === snapshot.pid,
    );
    return {
      id: snapshot.id,
      processId: foreground.pid,
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
  readCodexSessions: (
    lookups: ReadonlyMap<number, readonly number[]>,
  ) => Promise<Map<number, string>> = processCodexSessions,
): PtyInfoReader {
  type Identity = {
    readonly pid: number;
    readonly shellPid: number;
    readonly sessionId: string | null;
  };
  const identities = new Map<number, Identity>();
  let pendingIdentities = new Map<number, Identity>();
  let identityRefresh: Promise<void> | null = null;
  /**
   * Per pane, the other `codex` processes in its foreground group, refreshed
   * every read. npm's `codex` is a `node` launcher whose native `codex` child
   * holds the thread lock, so asking lsof about the leader alone finds none.
   * Kept outside `Identity`: replacing that object every read would make the
   * late-answer guard below drop every answer.
   */
  const codexMembers = new Map<number, readonly number[]>();

  function refreshIdentities(): void {
    if (identityRefresh !== null || pendingIdentities.size === 0) return;
    const targets = pendingIdentities;
    pendingIdentities = new Map();
    const lookups = new Map(
      [...targets].map(([paneId, target]) => [target.pid, codexMembers.get(paneId) ?? []]),
    );
    const current = Promise.resolve()
      .then(() => readCodexSessions(lookups))
      .catch((error) => {
        console.warn("Deck: Codex identity refresh failed", error);
        return new Map<number, string>();
      })
      .then((sessions) => {
        for (const [paneId, target] of targets) {
          // Object identity includes the observed foreground generation. A late
          // reading cannot attach to a replacement process (even with pid reuse).
          if (identities.get(paneId) === target) {
            identities.set(paneId, { ...target, sessionId: sessions.get(target.pid) ?? null });
          }
        }
      })
      .finally(() => {
        if (identityRefresh === current) identityRefresh = null;
        refreshIdentities();
      });
    identityRefresh = current;
  }

  function withCodexIdentity(
    infos: PtyInfo[],
    snapshots: readonly PtySessionSnapshot[],
  ): PtyInfo[] {
    const result = infos.map((info) => {
      const shellPid = snapshots.find((snapshot) => snapshot.id === info.id)?.pid;
      if (info.agent !== "codex" || info.processId === null || shellPid === undefined) {
        identities.delete(info.id);
        pendingIdentities.delete(info.id);
        codexMembers.delete(info.id);
        return info;
      }
      const old = identities.get(info.id);
      const identity =
        old?.pid === info.processId && old.shellPid === shellPid
          ? old
          : { pid: info.processId, shellPid, sessionId: null };
      identities.set(info.id, identity);
      pendingIdentities.set(info.id, identity);
      return { ...info, codexSessionId: identity.sessionId };
    });
    refreshIdentities();
    return result;
  }

  const cwdByPane = new Map<number, CachedCwd>();
  let pendingCwdTargets = new Map<number, number>();
  let cwdRefresh: Promise<void> | null = null;
  let processTableRead: Promise<macos.PsRow[]> | null = null;

  function readSharedProcessTable(processPlatform: PtyInfoPlatform): Promise<macos.PsRow[]> {
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
        const foreground = foregroundOf(processPlatform, rows, snapshot, agentMatchers);
        if (foreground === null) {
          continue;
        }
        foregroundTargets.set(snapshot.id, foreground.pid);
        codexMembers.set(
          snapshot.id,
          foreground.group === null
            ? []
            : rows
                .filter(
                  (row) =>
                    row.pgid === foreground.group &&
                    row.pid !== foreground.pid &&
                    normalizedProcessName(macos.argv0Name(row.args) ?? "") === "codex",
                )
                .map((row) => row.pid),
        );
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
      return withCodexIdentity(
        buildPtyInfo(snapshots, rows, cachedCwds, processPlatform, agentMatchers),
        snapshots,
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
