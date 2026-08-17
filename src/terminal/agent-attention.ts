import type { AgentPhase, ActivityTransition } from "./agent-activity";

/**
 * Pure, in-memory per-pane attention tracker — the core of the Agent Attention
 * Rail. It normalises the four raw inputs (OSC 9;4 activity, OSC 9/777 + bell
 * signals, process polls, and pane visibility) into a single latched
 * `PaneAttentionSnapshot` per pane, and aggregates those into a per-tab summary
 * and a navigation queue.
 *
 * Two independent axes:
 *  - `phase` — the live work signal ("unknown" | "idle" | "working" | "exited").
 *  - `attention` — a latched, actionable state that persists until acknowledge.
 * A pane can be `working` while still carrying a latched `warning`; the UI reads
 * attention before phase.
 *
 * Every input passes a process gate: activity and signals are ignored unless the
 * last poll recognised the pane's foreground process as an agent, and the tracker
 * never replays inputs that arrived before the gate opened.
 */

/** A latched, actionable attention state for a pane. */
export type AttentionKind =
  "none" | "completed" | "requested" | "warning" | "error";

/** What produced the current attention. */
export type AttentionSource =
  "osc-progress" | "osc-notification" | "bell" | "output-heuristic" | "process";

/** The public per-pane state the rest of the app reads. */
export interface PaneAttentionSnapshot {
  /** Live work signal. */
  phase: AgentPhase;
  /** Latched actionable attention (survives until `acknowledge`). */
  attention: AttentionKind;
  /** What produced `attention`; null when `attention` is "none". */
  source: AttentionSource | null;
  /** Whether the attention came from an explicit protocol signal or a heuristic. */
  confidence: "explicit" | "inferred";
  /** Last recognised agent label — kept after completion for post-run copy. */
  agentLabel: string | null;
  /** Per-pane unread, independent of the legacy tab-level unread. */
  unread: boolean;
  /**
   * The current agent has reached `working` at least once. What separates a
   * pane that finished a run and was checked (the rail's `done`) from one
   * that has never run anything (`idle`) — the fold itself lives in
   * `agent-rail-model.ts`, not here.
   */
  hasRun: boolean;
  /** When the visible state last changed (tracker clock). */
  changedAt: number;
  /** Bumps on every meaningful change — the notifier's dedupe key. */
  revision: number;
}

/**
 * An attention signal produced by the OSC-notification classifier / bell
 * handler. The tracker only consumes it — it never parses the payload.
 */
export interface AttentionSignal {
  kind: "requested";
  source: "osc-notification" | "bell";
  observedAt: number;
}

/** The single highest-precedence state across a tab's panes. */
export type TabAttentionKind =
  | "error"
  | "warning"
  | "requested"
  | "completed"
  | "working"
  | "unread"
  | "idle";

/** Per-tab aggregation of pane state. */
export interface AgentAttentionSummary {
  kind: TabAttentionKind;
  /** Panes whose attention is error/warning/requested/completed. */
  actionableCount: number;
  /** Panes whose phase is "working". */
  workingCount: number;
  /** Panes with a per-pane unread flag. */
  unreadCount: number;
}

/** A pane that is a target for focus-next-attention navigation. */
export interface AttentionCandidate {
  id: number;
  kind: AttentionKind;
  changedAt: number;
}

export interface AgentAttentionTracker {
  /** Feed one ordered activity transition. Gated by the recognised process. */
  noteActivity(
    id: number,
    transition: ActivityTransition,
  ): PaneAttentionSnapshot | null;
  /** Feed one OSC-notification/bell signal. Gated by the recognised process. */
  noteSignal(id: number, signal: AttentionSignal): PaneAttentionSnapshot | null;
  /** Register output for a pane, flagging unread when the pane is not visible. */
  noteOutputVisibility(
    id: number,
    visible: boolean,
  ): PaneAttentionSnapshot | null;
  /** Record the last-polled foreground process; opens/closes the agent gate. */
  noteProcess(
    id: number,
    process: string | null,
    isAgent: boolean,
  ): PaneAttentionSnapshot | null;
  /** The pane's PTY exited. */
  noteExit(id: number): PaneAttentionSnapshot | null;
  /** The user focused the pane: clear attention + unread (phase untouched). */
  acknowledge(id: number): PaneAttentionSnapshot | null;
  /** Current snapshot, or null for a pane the tracker has never seen. */
  snapshot(id: number): PaneAttentionSnapshot | null;
  /** Aggregate the given panes into a per-tab summary. */
  summarize(paneIds: readonly number[]): AgentAttentionSummary;
  /** Every pane with actionable attention, sorted for navigation. */
  actionable(): AttentionCandidate[];
  /** Forget every pane outside `live` — call after a pane/tab closes. */
  prune(live: readonly number[]): void;
}

/** Internal per-pane record. Treated immutably: reducers return fresh copies. */
interface PaneState {
  readonly phase: AgentPhase;
  readonly attention: AttentionKind;
  readonly source: AttentionSource | null;
  readonly confidence: "explicit" | "inferred";
  readonly agentLabel: string | null;
  readonly unread: boolean;
  /** The current agent has reached `working` at least once (see snapshot). */
  readonly hasRun: boolean;
  readonly changedAt: number;
  readonly revision: number;
  /** Gate open — the last poll recognised an agent. */
  readonly isAgent: boolean;
  /** True once the pane has been polled at least once (pre-poll = unknown). */
  readonly hasProcess: boolean;
  /** Last polled process label (agent or shell). */
  readonly lastProcess: string | null;
  /** When the current gate opened; filters stale/pre-gate transitions. */
  readonly gateOpenedAt: number;
}

/** Severity ranking for the attention axis — higher wins, never downgrades. */
const ATTENTION_RANK: Record<AttentionKind, number> = {
  none: 0,
  completed: 1,
  requested: 2,
  warning: 3,
  error: 4,
};

/** Per-tab precedence: error > warning > requested > completed > working > unread > idle. */
const TAB_KIND_BY_RANK: readonly TabAttentionKind[] = [
  "idle",
  "unread",
  "working",
  "completed",
  "requested",
  "warning",
  "error",
];

function freshState(): PaneState {
  return {
    phase: "unknown",
    attention: "none",
    source: null,
    confidence: "explicit",
    agentLabel: null,
    unread: false,
    hasRun: false,
    changedAt: 0,
    revision: 0,
    isAgent: false,
    hasProcess: false,
    lastProcess: null,
    gateOpenedAt: 0,
  };
}

function isActionable(kind: AttentionKind): boolean {
  return kind !== "none";
}

/**
 * The fields a caller can observe. Used to decide whether a mutation is a
 * "real change" worth bumping the revision / notifying about.
 */
function visibleSignature(s: PaneState): string {
  return JSON.stringify([
    s.phase,
    s.attention,
    s.source,
    s.confidence,
    s.agentLabel,
    s.unread,
  ]);
}

function toSnapshot(s: PaneState): PaneAttentionSnapshot {
  return {
    phase: s.phase,
    attention: s.attention,
    source: s.source,
    confidence: s.confidence,
    agentLabel: s.agentLabel,
    unread: s.unread,
    hasRun: s.hasRun,
    changedAt: s.changedAt,
    revision: s.revision,
  };
}

/**
 * Latch an attention state under severity precedence: a strictly higher-ranked
 * kind replaces the current one; anything equal or lower is a no-op (so a
 * lower signal never downgrades a latched higher one, and duplicates are
 * ignored).
 */
function latch(
  s: PaneState,
  kind: AttentionKind,
  source: AttentionSource,
  confidence: "explicit" | "inferred",
): PaneState {
  if (ATTENTION_RANK[kind] <= ATTENTION_RANK[s.attention]) {
    return s;
  }
  return { ...s, attention: kind, source, confidence };
}

/** Per-pane rank for the tab-level precedence order. */
function tabRank(s: PaneState): number {
  switch (s.attention) {
    case "error":
      return 6;
    case "warning":
      return 5;
    case "requested":
      return 4;
    case "completed":
      return 3;
    case "none":
      break;
  }
  if (s.phase === "working") {
    return 2;
  }
  if (s.unread) {
    return 1;
  }
  return 0;
}

export function createAgentAttentionTracker(
  options: { now?: () => number } = {},
): AgentAttentionTracker {
  const now = options.now ?? Date.now;
  const panes = new Map<number, PaneState>();

  /**
   * Persist `candidate` for `id`. Bumps revision + `changedAt` only when a
   * visible field actually changed, returning the new snapshot then; otherwise
   * persists internal-only changes silently and returns null.
   */
  function commit(
    id: number,
    prev: PaneState,
    candidate: PaneState,
  ): PaneAttentionSnapshot | null {
    if (visibleSignature(prev) === visibleSignature(candidate)) {
      panes.set(id, candidate);
      return null;
    }
    const next: PaneState = {
      ...candidate,
      revision: prev.revision + 1,
      changedAt: now(),
    };
    panes.set(id, next);
    return toSnapshot(next);
  }

  /**
   * Whether an activity transition may act on the pane: the gate must be open,
   * the transition must post-date the gate, and a heuristic streak must itself
   * have begun after the gate (its tail cannot ride past the gate).
   */
  function gateAccepts(s: PaneState, transition: ActivityTransition): boolean {
    if (!s.isAgent) {
      return false;
    }
    if (transition.observedAt < s.gateOpenedAt) {
      return false;
    }
    if (transition.source === "output-heuristic") {
      const evidenceStartedAt =
        transition.evidenceStartedAt ?? transition.observedAt;
      if (evidenceStartedAt < s.gateOpenedAt) {
        return false;
      }
    }
    return true;
  }

  function reduceActivity(
    prev: PaneState,
    transition: ActivityTransition,
  ): PaneState {
    if (transition.phase === "working") {
      let next: PaneState = { ...prev, phase: "working", hasRun: true };
      // A fresh work cycle self-clears a stale completed; a latched
      // requested/warning/error stays.
      if (next.attention === "completed") {
        next = { ...next, attention: "none", source: null };
      }
      if (transition.severity === "error") {
        next = latch(next, "error", "osc-progress", "explicit");
      } else if (transition.severity === "warning") {
        next = latch(next, "warning", "osc-progress", "explicit");
      }
      return next;
    }
    // Idle transition: completion only when the pane actually reached working.
    let next = prev;
    if (prev.phase === "working") {
      const source: AttentionSource =
        transition.source === "osc-progress"
          ? "osc-progress"
          : "output-heuristic";
      const confidence =
        transition.source === "osc-progress" ? "explicit" : "inferred";
      next = latch(next, "completed", source, confidence);
    }
    return { ...next, phase: "idle" };
  }

  return {
    noteActivity(id, transition) {
      const prev = panes.get(id);
      if (prev === undefined) {
        return null; // pre-poll, never seen — ignored, not stored, not replayed
      }
      if (!gateAccepts(prev, transition)) {
        return null;
      }
      return commit(id, prev, reduceActivity(prev, transition));
    },

    noteSignal(id, signal) {
      const prev = panes.get(id);
      if (prev === undefined) {
        return null;
      }
      if (!prev.isAgent || signal.observedAt < prev.gateOpenedAt) {
        return null;
      }
      return commit(
        id,
        prev,
        latch(prev, "requested", signal.source, "explicit"),
      );
    },

    noteOutputVisibility(id, visible) {
      const prev = panes.get(id) ?? freshState();
      // Output while visible is already seen (never sets unread, never clears —
      // only acknowledge clears). Output while hidden flags unread.
      const candidate = visible ? prev : { ...prev, unread: true };
      return commit(id, prev, candidate);
    },

    noteProcess(id, process, isAgent) {
      const prev = panes.get(id) ?? freshState();

      // A repeated identical poll is not a new generation: keep the gate as-is.
      if (
        prev.hasProcess &&
        prev.lastProcess === process &&
        prev.isAgent === isAgent
      ) {
        return null;
      }

      let candidate: PaneState;
      if (isAgent) {
        if (prev.isAgent && prev.lastProcess !== process) {
          // agent → agent (different label): reset generation + signal-derived
          // attention + evidence, open a fresh gate, infer no completion.
          // Per-pane unread is deliberately preserved.
          candidate = {
            ...prev,
            phase: "unknown",
            attention: "none",
            source: null,
            confidence: "explicit",
            agentLabel: process,
            isAgent: true,
            hasProcess: true,
            lastProcess: process,
            gateOpenedAt: now(),
          };
        } else {
          // pre-poll/shell → agent: open the gate. Opening does not replay any
          // pre-gate activity/signal, so phase/attention are left as-is.
          // `hasRun` resets with the gate: a fresh agent has run nothing yet,
          // whatever the previous occupant of this pane did.
          candidate = {
            ...prev,
            agentLabel: process,
            isAgent: true,
            hasProcess: true,
            lastProcess: process,
            hasRun: false,
            gateOpenedAt: now(),
          };
        }
      } else if (prev.isAgent) {
        // agent → shell: atomic completion, then close the gate.
        const wasWorking = prev.phase === "working";
        const higherLatched =
          prev.attention === "requested" ||
          prev.attention === "warning" ||
          prev.attention === "error";
        let completed = prev;
        if (wasWorking && !higherLatched && prev.attention !== "completed") {
          // Exactly one inferred completion; never duplicates an explicit one.
          completed = {
            ...prev,
            attention: "completed",
            source: "process",
            confidence: "inferred",
          };
        }
        candidate = {
          ...completed,
          phase: "idle",
          isAgent: false,
          hasProcess: true,
          lastProcess: process,
          gateOpenedAt: 0,
          // agentLabel kept for post-completion copy.
        };
      } else {
        // pre-poll → shell, or shell → shell: just record the label; the gate
        // stays closed and nothing replays.
        candidate = {
          ...prev,
          isAgent: false,
          hasProcess: true,
          lastProcess: process,
        };
      }

      return commit(id, prev, candidate);
    },

    noteExit(id) {
      const prev = panes.get(id) ?? freshState();
      const candidate: PaneState = {
        ...prev,
        phase: "exited",
        isAgent: false,
        gateOpenedAt: 0,
      };
      return commit(id, prev, candidate);
    },

    acknowledge(id) {
      const prev = panes.get(id);
      if (prev === undefined) {
        return null;
      }
      const candidate: PaneState = {
        ...prev,
        attention: "none",
        source: null,
        confidence: "explicit",
        unread: false,
      };
      return commit(id, prev, candidate);
    },

    snapshot(id) {
      const state = panes.get(id);
      return state ? toSnapshot(state) : null;
    },

    summarize(paneIds) {
      let actionableCount = 0;
      let workingCount = 0;
      let unreadCount = 0;
      let bestRank = 0;
      for (const id of paneIds) {
        const state = panes.get(id);
        if (state === undefined) {
          continue;
        }
        if (isActionable(state.attention)) {
          actionableCount += 1;
        }
        if (state.phase === "working") {
          workingCount += 1;
        }
        if (state.unread) {
          unreadCount += 1;
        }
        const rank = tabRank(state);
        if (rank > bestRank) {
          bestRank = rank;
        }
      }
      return {
        kind: TAB_KIND_BY_RANK[bestRank],
        actionableCount,
        workingCount,
        unreadCount,
      };
    },

    actionable() {
      const candidates: AttentionCandidate[] = [];
      for (const [id, state] of panes) {
        if (isActionable(state.attention)) {
          candidates.push({
            id,
            kind: state.attention,
            changedAt: state.changedAt,
          });
        }
      }
      candidates.sort((a, b) => {
        const rankDelta = ATTENTION_RANK[b.kind] - ATTENTION_RANK[a.kind];
        if (rankDelta !== 0) {
          return rankDelta; // higher severity first
        }
        return a.changedAt - b.changedAt; // oldest first, stable
      });
      return candidates;
    },

    prune(live) {
      const keep = new Set(live);
      const doomed: number[] = [];
      for (const id of panes.keys()) {
        if (!keep.has(id)) {
          doomed.push(id);
        }
      }
      for (const id of doomed) {
        panes.delete(id);
      }
    },
  };
}
