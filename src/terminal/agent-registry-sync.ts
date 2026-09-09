import {
  REGISTRY_STATUS_WAITING,
  registryByPid,
  type RegistryEntry,
  type RegistrySnapshot,
} from "../lib/agent-registry";

/**
 * Joins the Claude registry to the panes of one window (agent-signal contract
 * layer, stage 1; spec §4 "Join on pid").
 *
 * Every `intervalMs` — while at least one pane is classified `claude` — it
 * asks main for the latest `claude agents --json` snapshot, matches each
 * Claude pane's foreground `processId` (from `pty_info`) against the
 * registry's `pid`, and hands the tracker a `RegistryFact` per pane: the
 * session id (a FACT, where the tail store used to guess it from transcript
 * mtimes), whether Claude reports itself `waiting`, and on what.
 *
 * Freshness (spec §4, stage 3, folded in here because the counting belongs
 * to the poll that does it): a pane the registry stops listing is reported
 * ABSENT only after `missesBeforeAbsent` consecutive fresh polls without it —
 * one missed listing is a race with the process table, two is the process
 * gone. A STALE snapshot (main's poll failed) counts for nothing either way,
 * so a hung CLI cannot clear a real `waiting` and cannot invent one.
 *
 * Pure of hosts: the fetch, the pane facts and the clock are all injected, so
 * this runs under a fake timer with a scripted registry.
 */

/** What the registry says about one pane, joined on pid. */
export interface RegistryFact {
  readonly sessionId: string;
  readonly waiting: boolean;
  /** `waitingFor` when waiting: `permission prompt`, `input needed`, … */
  readonly detail: string | null;
}

export interface AgentRegistrySyncDeps {
  readonly fetch: () => Promise<RegistrySnapshot>;
  /** Every live pane id in this window. */
  readonly paneIds: () => readonly number[];
  /** The classified agent of a pane, or null. Only `claude` panes are joined. */
  readonly agentOf: (paneId: number) => string | null;
  /** The pane's foreground pid from the last `pty_info`, or null. */
  readonly processIdOf: (paneId: number) => number | null;
  /** A fact for the pane, or null once it has been absent long enough. */
  readonly onFact: (paneId: number, fact: RegistryFact | null) => void;
  /** Called after every applied poll, so the caller can re-render once. */
  readonly onApplied?: () => void;
  readonly intervalMs?: number;
  readonly missesBeforeAbsent?: number;
}

export interface AgentRegistrySync {
  start(): void;
  stop(): void;
  /** One immediate poll; never throws. */
  poll(): Promise<void>;
  /** Forget per-pane counters for panes outside `live`. */
  prune(live: readonly number[]): void;
}

export const REGISTRY_SYNC_INTERVAL_MS = 5000;
const DEFAULT_MISSES_BEFORE_ABSENT = 2;
const CLAUDE = "claude";

export function factOf(entry: RegistryEntry): RegistryFact {
  const waiting = entry.status === REGISTRY_STATUS_WAITING;
  return {
    sessionId: entry.sessionId,
    waiting,
    detail: waiting ? entry.waitingFor : null,
  };
}

export function createAgentRegistrySync(deps: AgentRegistrySyncDeps): AgentRegistrySync {
  const intervalMs = deps.intervalMs ?? REGISTRY_SYNC_INTERVAL_MS;
  const missesBeforeAbsent = deps.missesBeforeAbsent ?? DEFAULT_MISSES_BEFORE_ABSENT;
  /** Consecutive fresh polls in which a Claude pane's pid was not listed. */
  const misses = new Map<number, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  function claudePanes(): number[] {
    return deps.paneIds().filter((id) => deps.agentOf(id) === CLAUDE);
  }

  function apply(snapshot: RegistrySnapshot, panes: readonly number[]): void {
    if (!snapshot.available || snapshot.stale) {
      return; // today's behaviour for this tick; nothing is cleared, nothing invented
    }
    const byPid = registryByPid(snapshot);
    for (const paneId of panes) {
      const pid = deps.processIdOf(paneId);
      const entry = pid === null ? undefined : byPid.get(pid);
      if (entry !== undefined) {
        misses.delete(paneId);
        deps.onFact(paneId, factOf(entry));
        continue;
      }
      const seen = (misses.get(paneId) ?? 0) + 1;
      misses.set(paneId, seen);
      if (seen >= missesBeforeAbsent) {
        deps.onFact(paneId, null);
      }
    }
    deps.onApplied?.();
  }

  async function pollOnce(): Promise<void> {
    const panes = claudePanes();
    if (panes.length === 0) {
      return; // no Claude pane: no ask, so main's loop lets itself lapse
    }
    let snapshot: RegistrySnapshot;
    try {
      snapshot = await deps.fetch();
    } catch (error) {
      console.warn("agent registry poll failed:", error);
      return;
    }
    // Re-read the panes after the await: a pane can close mid-flight, and a
    // fact for a dead id would be handed to a tracker that has pruned it.
    const live = new Set(deps.paneIds());
    apply(
      snapshot,
      panes.filter((id) => live.has(id)),
    );
  }

  function scheduleNext(): void {
    if (!running || timer !== null) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, intervalMs);
  }

  function poll(): Promise<void> {
    if (inFlight !== null) {
      return inFlight;
    }
    const current = pollOnce().finally(() => {
      if (inFlight === current) {
        inFlight = null;
      }
      scheduleNext();
    });
    inFlight = current;
    return current;
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    poll,
    prune(live) {
      const keep = new Set(live);
      for (const id of [...misses.keys()]) {
        if (!keep.has(id)) {
          misses.delete(id);
        }
      }
    },
  };
}
