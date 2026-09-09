import type { ActivitySnapshot, AgentPhase, ActivityTransition } from "./agent-activity";

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
 * never replays inputs that arrived before the gate opened — with ONE stated
 * exception since 2026-09-03: a gate that opens may be SEEDED from the activity
 * module's own OSC-backed snapshot (`noteProcess`'s `seed`), because an agent
 * that reported progress before the poll recognised it was otherwise invisible
 * for a whole run (trust audit §4.5).
 *
 * Since 2026-09-03 (agent-signal contract layer, stage 0) every snapshot also
 * says how much to trust itself: `confidence` for the attention axis and
 * `phaseConfidence` for the phase axis, each `explicit` (the CLI said so, over a
 * channel it documents), `inferred` (Deck read it off output timing or the
 * process table) or `unknown` (nothing has been seen yet). The rail draws the
 * difference (DL-27.3); this module only records it.
 */

/** A latched, actionable attention state for a pane. */
export type AttentionKind = "none" | "completed" | "requested" | "warning" | "error";

/**
 * What produced the current attention.
 *
 * `registry`, `hook` and `server` are the contract-layer sources (spec §5):
 * `claude agents --json`, a per-pane hook post, and opencode's own server.
 */
export type AttentionSource =
  | "osc-progress"
  | "osc-notification"
  | "bell"
  | "output-heuristic"
  | "process"
  | "registry"
  | "hook"
  | "server";

/**
 * How much a state is to be trusted. `explicit` is a signal the CLI documents
 * (OSC 9;4, a BEL, a hook, the registry); `inferred` is Deck's own reading of
 * output timing or the process table; `unknown` is "nothing seen yet".
 */
export type SignalConfidence = "explicit" | "inferred" | "unknown";

/** The public per-pane state the rest of the app reads. */
export interface PaneAttentionSnapshot {
  /** Live work signal. */
  phase: AgentPhase;
  /** Latched actionable attention (survives until `acknowledge`). */
  attention: AttentionKind;
  /** What produced `attention`; null when `attention` is "none". */
  source: AttentionSource | null;
  /**
   * Whether the attention came from an explicit protocol signal or a
   * heuristic. `explicit` while `attention` is "none" — the axis has nothing
   * to be unsure about.
   */
  confidence: "explicit" | "inferred";
  /**
   * How `phase` was learned. `unknown` until the pane produces a signal —
   * the rail's resting dot; `inferred` for the output-timing fallback and the
   * process table; `explicit` for OSC 9;4 and the contract-layer sources.
   */
  phaseConfidence: SignalConfidence;
  /**
   * Exit status of the pane's PTY once `phase` is "exited" through `noteExit`;
   * null for an agent that left the foreground with its shell still up (the
   * agent → shell path, which is the common way an agent ENDS), and null on a
   * host that reports none (Tauri).
   */
  exitCode: number | null;
  /** Last recognised agent label — kept after completion for post-run copy. */
  agentLabel: string | null;
  /**
   * The session this pane's agent is running, as a FACT — from the Claude
   * registry (stage 1) or, later, a hook or server — never from a transcript
   * mtime. Null until a contract-layer source says so; reset with the gate,
   * since a session cannot outlive the process that ran it.
   */
  sessionId: string | null;
  /**
   * What the agent is waiting on, when a contract-layer source says it is
   * (`permission prompt`, `input needed`, …) — the accessible name's detail.
   * Null whenever `attention` is not a registry/hook/server `requested`.
   */
  detail: string | null;
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

/**
 * What the Claude registry says about one pane, joined on pid by
 * `agent-registry-sync.ts` (stage 1). `null` means the registry has stopped
 * listing the pane's process for long enough to be believed.
 */
export interface RegistryFact {
  readonly sessionId: string;
  readonly waiting: boolean;
  readonly detail: string | null;
}

/**
 * One event a CLI reported about itself, already mapped by
 * `src/lib/agent-signal-map.ts` (stage 2). Mirrors that module's
 * `ContractSignal` so this one stays free of a `lib` import in the other
 * direction.
 */
export interface ContractSignal {
  readonly source: "hook" | "server";
  readonly kind: "session" | "working" | "completed" | "requested" | "answered" | "error";
  readonly sessionId: string;
  readonly detail: string | null;
  readonly message: string | null;
  readonly observedAt: number;
}

/**
 * How long a contract-layer state is believed without a newer event while
 * `ps` still says the agent is alive (spec §4, stage 3: "hook 120 s"). Past
 * it the mark turns inferred — a missed hook cannot pin a row forever.
 */
export const CONTRACT_FRESHNESS_MS = 120_000;

/** The single highest-precedence state across a tab's panes. */
export type TabAttentionKind =
  "error" | "warning" | "requested" | "completed" | "working" | "unread" | "idle";

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
  noteActivity(id: number, transition: ActivityTransition): PaneAttentionSnapshot | null;
  /** Feed one OSC-notification/bell signal. Gated by the recognised process. */
  noteSignal(id: number, signal: AttentionSignal): PaneAttentionSnapshot | null;
  /** Register output for a pane, flagging unread when the pane is not visible. */
  noteOutputVisibility(id: number, visible: boolean): PaneAttentionSnapshot | null;
  /**
   * Record the last-polled foreground process; opens/closes the agent gate.
   *
   * `seed` is the activity module's snapshot for the pane at poll time. When
   * the gate OPENS and the seed is OSC-backed, its phase becomes the pane's
   * phase at once instead of `unknown` — the one replay this module allows,
   * and only for an explicit signal: a heuristic streak at gate-open is the
   * CLI's own startup screen, and seeding from it would turn every launch
   * into a `working` → silence → `completed` lie (trust audit §4.5).
   */
  noteProcess(
    id: number,
    process: string | null,
    isAgent: boolean,
    seed?: ActivitySnapshot,
  ): PaneAttentionSnapshot | null;
  /** The pane's PTY exited, with the status the host reported (null = unknown). */
  noteExit(id: number, exitCode?: number | null): PaneAttentionSnapshot | null;
  /**
   * The Claude registry's word on this pane (stage 1). `waiting` latches an
   * EXPLICIT `requested` with `detail`; a fact that is not waiting clears a
   * `requested` the registry itself raised and nothing else; `null` (the
   * process is no longer listed) clears the same and forgets the session.
   * Gated like every other input: a pane whose gate is closed is not an
   * agent, whatever pid the registry matched.
   */
  noteRegistry(id: number, fact: RegistryFact | null): PaneAttentionSnapshot | null;
  /**
   * A CLI's own event for this pane, over a channel it documents — a Claude
   * hook post or opencode's server stream (stage 2). Every kind is explicit.
   * Gated like every other input, and generation-checked: a hook post naming
   * a session other than the pane's current one is a previous occupant's and
   * is dropped (stage 3). A server event may name a NEW session — one opencode
   * TUI runs several — and rotates the pane's session instead.
   */
  noteContract(id: number, signal: ContractSignal): PaneAttentionSnapshot | null;
  /**
   * Deck minted `--session-id` for the command about to be typed into this
   * pane (stage 2, spec §10.2). Held until the gate next opens for an agent,
   * then becomes the pane's session — so the pairing exists before the first
   * byte of output, and the registry or a hook only ever confirms it.
   */
  noteMintedSession(id: number, sessionId: string): void;
  /**
   * The clock moved (stage 3, freshness). A contract-layer state older than
   * `CONTRACT_FRESHNESS_MS` with the agent still in the foreground falls back
   * to the process table and OSC: the state stays, drawn as inferred. Returns
   * the ids of the panes whose snapshot changed.
   */
  tick(now: number): number[];
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
  readonly phaseConfidence: SignalConfidence;
  readonly exitCode: number | null;
  readonly agentLabel: string | null;
  readonly sessionId: string | null;
  readonly detail: string | null;
  /** A minted `--session-id` waiting for the gate to open (stage 2). */
  readonly pendingSessionId: string | null;
  /** Clock of the last accepted contract-layer signal; null when none. */
  readonly contractAt: number | null;
  /** The phase was last set by a contract-layer signal (stage 3's freshness). */
  readonly phaseFromContract: boolean;
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
    phaseConfidence: "unknown",
    exitCode: null,
    agentLabel: null,
    sessionId: null,
    detail: null,
    pendingSessionId: null,
    contractAt: null,
    phaseFromContract: false,
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
    s.phaseConfidence,
    s.exitCode,
    s.agentLabel,
    s.sessionId,
    s.detail,
    s.unread,
  ]);
}

function toSnapshot(s: PaneState): PaneAttentionSnapshot {
  return {
    phase: s.phase,
    attention: s.attention,
    source: s.source,
    confidence: s.confidence,
    phaseConfidence: s.phaseConfidence,
    exitCode: s.exitCode,
    agentLabel: s.agentLabel,
    sessionId: s.sessionId,
    detail: s.detail,
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

/** The confidence an activity transition's source earns. */
function transitionConfidence(source: ActivityTransition["source"]): SignalConfidence {
  return source === "osc-progress" ? "explicit" : "inferred";
}

/**
 * The phase a freshly opened gate starts in, read off the activity module's
 * snapshot. Only an OSC-backed snapshot seeds anything: the fallback's
 * "sustained output" at gate-open is the CLI painting its own startup screen,
 * which `gateAccepts` has always refused for exactly that reason.
 */
function seededPhase(seed: ActivitySnapshot | undefined): {
  readonly phase: AgentPhase;
  readonly phaseConfidence: SignalConfidence;
  readonly hasRun: boolean;
} {
  if (seed === undefined || seed.source !== "osc-progress") {
    return { phase: "unknown", phaseConfidence: "unknown", hasRun: false };
  }
  if (seed.phase === "working") {
    return { phase: "working", phaseConfidence: "explicit", hasRun: true };
  }
  if (seed.phase === "idle") {
    return { phase: "idle", phaseConfidence: "explicit", hasRun: false };
  }
  return { phase: "unknown", phaseConfidence: "unknown", hasRun: false };
}

/**
 * The agent has left the pane's foreground while the pane stays up: the
 * ended state the rail draws as its sixth word (DL-27.3, 2026-09-03).
 *
 * The latches that were ABOUT the live agent go with it — a `requested` it
 * can no longer be answered on and a `completed` it will never be checked in
 * — so a dead agent never reads as `asked` (trust audit §4.3, Codex's
 * objection to §7.3). `warning` and `error` survive: a CLI that reported a
 * failure and then exited has failed, and the exit does not un-say it.
 */
function endedAgent(prev: PaneState): PaneState {
  const clearsLatch = prev.attention === "requested" || prev.attention === "completed";
  return {
    ...prev,
    phase: "exited",
    // The process table is the OS's own record of what holds the tty, which
    // is a fact rather than a reading — so an ended mark is never hollow.
    phaseConfidence: "explicit",
    exitCode: null,
    attention: clearsLatch ? "none" : prev.attention,
    source: clearsLatch ? null : prev.source,
    confidence: clearsLatch ? "explicit" : prev.confidence,
    // The session id is kept: it is what a resume of this pane would reopen,
    // and the journal reads it off the snapshot. The question it was waiting
    // on is not — nobody can answer it any more.
    detail: null,
  };
}

/**
 * An ended agent the user has now checked — focused the pane, or typed into
 * the shell that replaced it. The pane is an idle shell again, and the NAME
 * goes with the end: `agentLabel` is what `syncViews` prints the `ended` row
 * under, and leaving it would let the SHELL's own later exit (`noteExit` on a
 * pane with no agent) reprint "claude · ended" for a process that ended an
 * hour ago. A new agent opening the gate names itself afresh.
 */
function checkedEnd(s: PaneState): PaneState {
  return { ...s, phase: "idle", agentLabel: null };
}

/**
 * A `requested` raised by a contract-layer source is the only latch that
 * source may take back: the CLI said "waiting", and the CLI now says it is
 * not. A BEL or an OSC notification stays latched until acknowledged, as
 * before — those are one-shot signals with no "no longer" to report.
 */
function clearContractRequested(s: PaneState): PaneState {
  if (s.attention !== "requested" || s.source !== "registry") {
    return { ...s, detail: null };
  }
  return { ...s, attention: "none", source: null, confidence: "explicit", detail: null };
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
  function commit(id: number, prev: PaneState, candidate: PaneState): PaneAttentionSnapshot | null {
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
      const evidenceStartedAt = transition.evidenceStartedAt ?? transition.observedAt;
      if (evidenceStartedAt < s.gateOpenedAt) {
        return false;
      }
    }
    return true;
  }

  function reduceActivity(prev: PaneState, transition: ActivityTransition): PaneState {
    const phaseConfidence = transitionConfidence(transition.source);
    if (transition.phase === "working") {
      let next: PaneState = {
        ...prev,
        phase: "working",
        phaseConfidence,
        phaseFromContract: false,
        hasRun: true,
      };
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
        transition.source === "osc-progress" ? "osc-progress" : "output-heuristic";
      next = latch(
        next,
        "completed",
        source,
        phaseConfidence === "explicit" ? "explicit" : "inferred",
      );
    }
    return { ...next, phase: "idle", phaseConfidence, phaseFromContract: false };
  }

  /**
   * A contract-layer signal applied to a pane whose gate is open and whose
   * generation the signal belongs to. Every state it sets is explicit; the
   * clock it stamps is what `tick` measures freshness from.
   */
  function reduceContract(prev: PaneState, signal: ContractSignal): PaneState {
    const stamped: PaneState = {
      ...prev,
      sessionId: signal.sessionId,
      contractAt: signal.observedAt,
    };
    switch (signal.kind) {
      case "session":
        return stamped;
      case "working": {
        let next: PaneState = {
          ...stamped,
          phase: "working",
          phaseConfidence: "explicit",
          phaseFromContract: true,
          hasRun: true,
        };
        if (next.attention === "completed") {
          next = { ...next, attention: "none", source: null, confidence: "explicit" };
        }
        return next;
      }
      case "completed": {
        const wasWorking = prev.phase === "working";
        const next: PaneState = {
          ...stamped,
          phase: "idle",
          phaseConfidence: "explicit",
          phaseFromContract: true,
          // A turn that ended is a run, whether or not this tracker saw it start.
          hasRun: true,
        };
        // Claude's `Stop` and opencode's `session.idle` both mean "the turn
        // ended": latch the completion even when the phase never read working
        // here — the hook is the CLI's word, and the row must say the run
        // finished. A `requested` this source raised is answered by the end.
        const cleared =
          next.attention === "requested" && next.source === signal.source
            ? {
                ...next,
                attention: "none" as const,
                source: null,
                confidence: "explicit" as const,
                detail: null,
              }
            : next;
        if (cleared.attention === "completed") {
          // The same word again, freshly said: a completion `tick` had turned
          // inferred is a report once more.
          return { ...cleared, source: signal.source, confidence: "explicit" };
        }
        return wasWorking || cleared.attention === "none"
          ? latch(cleared, "completed", signal.source, "explicit")
          : cleared;
      }
      case "requested": {
        if (stamped.attention === "requested") {
          // Re-said, not re-ranked: `latch` is a no-op for an equal kind, but
          // a fresh report restores an explicit mark `tick` may have hollowed.
          return {
            ...stamped,
            source: signal.source,
            confidence: "explicit",
            detail: signal.detail,
          };
        }
        const latched = latch(stamped, "requested", signal.source, "explicit");
        return {
          ...latched,
          detail: latched.attention === "requested" ? signal.detail : latched.detail,
        };
      }
      case "answered":
        return stamped.attention === "requested" && stamped.source === signal.source
          ? { ...stamped, attention: "none", source: null, confidence: "explicit", detail: null }
          : stamped;
      case "error": {
        const latched =
          stamped.attention === "error"
            ? { ...stamped, source: signal.source, confidence: "explicit" as const }
            : latch(stamped, "error", signal.source, "explicit");
        return {
          ...latched,
          phase: "idle",
          phaseConfidence: "explicit",
          phaseFromContract: true,
          detail: latched.attention === "error" ? signal.detail : latched.detail,
        };
      }
    }
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
      return commit(id, prev, latch(prev, "requested", signal.source, "explicit"));
    },

    noteOutputVisibility(id, visible) {
      const prev = panes.get(id) ?? freshState();
      // Output while visible is already seen (never sets unread, never clears —
      // only acknowledge clears). Output while hidden flags unread. An ended
      // agent is the one thing visible output DOES clear: the user is typing
      // into the shell that replaced it, so the exit has been seen.
      const candidate = visible
        ? prev.phase === "exited" && !prev.isAgent
          ? checkedEnd(prev)
          : prev
        : { ...prev, unread: true };
      return commit(id, prev, candidate);
    },

    noteProcess(id, process, isAgent, seed) {
      const prev = panes.get(id) ?? freshState();

      // A repeated identical poll is not a new generation: keep the gate as-is.
      if (prev.hasProcess && prev.lastProcess === process && prev.isAgent === isAgent) {
        return null;
      }

      let candidate: PaneState;
      if (isAgent) {
        const seeded = seededPhase(seed);
        if (prev.isAgent && prev.lastProcess !== process) {
          // agent → agent (different label): reset generation + signal-derived
          // attention + evidence, open a fresh gate, infer no completion.
          // Per-pane unread is deliberately preserved.
          candidate = {
            ...prev,
            ...seeded,
            attention: "none",
            source: null,
            confidence: "explicit",
            exitCode: null,
            agentLabel: process,
            sessionId: prev.pendingSessionId,
            pendingSessionId: null,
            contractAt: null,
            phaseFromContract: false,
            detail: null,
            isAgent: true,
            hasProcess: true,
            lastProcess: process,
            gateOpenedAt: now(),
          };
        } else {
          // pre-poll/shell → agent: open the gate. Opening replays nothing the
          // gate itself saw; the only thing carried in is the activity
          // module's OSC-backed snapshot (`seededPhase`), which is what closes
          // the startup blind window. `hasRun` resets with the gate: a fresh
          // agent has run nothing yet, whatever the previous occupant of this
          // pane did — unless the seed says it is already working.
          candidate = {
            ...prev,
            ...seeded,
            exitCode: null,
            agentLabel: process,
            // A new occupant has no session yet, whatever the last one ran —
            // unless Deck minted one for the command it just typed (stage 2).
            sessionId: prev.pendingSessionId,
            pendingSessionId: null,
            contractAt: null,
            phaseFromContract: false,
            detail: null,
            isAgent: true,
            hasProcess: true,
            lastProcess: process,
            gateOpenedAt: now(),
          };
        }
      } else if (prev.isAgent) {
        // agent → shell: the agent ENDED. Before 2026-09-03 this latched an
        // inferred `completed` when the pane was working, so a crash wore the
        // same yellow as a finished run (trust audit §4.3). It is the rail's
        // own `ended` word now, and it clears the latches that were about the
        // live agent; see `endedAgent`.
        candidate = {
          ...endedAgent(prev),
          isAgent: false,
          hasProcess: true,
          lastProcess: process,
          gateOpenedAt: 0,
          // agentLabel kept: it is what the ended row is named after.
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

    noteExit(id, exitCode = null) {
      const prev = panes.get(id) ?? freshState();
      const candidate: PaneState = {
        ...(prev.isAgent ? endedAgent(prev) : prev),
        phase: "exited",
        phaseConfidence: "explicit",
        exitCode: typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : null,
        isAgent: false,
        gateOpenedAt: 0,
      };
      return commit(id, prev, candidate);
    },

    noteRegistry(id, fact) {
      const prev = panes.get(id);
      if (prev === undefined || !prev.isAgent) {
        return null;
      }
      if (fact === null) {
        // Absent long enough to be believed: the process the registry knew is
        // gone. The gate (the process table) decides whether the pane's agent
        // is; this only withdraws what the registry itself said.
        return commit(id, prev, { ...clearContractRequested(prev), sessionId: null });
      }
      const withSession: PaneState = { ...prev, sessionId: fact.sessionId };
      if (!fact.waiting) {
        return commit(id, prev, clearContractRequested(withSession));
      }
      // `waiting` is the one status Claude documents. Latch precedence holds
      // — a latched error or warning is not downgraded — but the detail is
      // recorded either way, so the accessible name can say what is waited on
      // once the higher latch clears.
      const latched = latch(withSession, "requested", "registry", "explicit");
      return commit(id, prev, {
        ...latched,
        detail: latched.attention === "requested" ? fact.detail : null,
      });
    },

    noteContract(id, signal) {
      const prev = panes.get(id);
      if (prev === undefined || !prev.isAgent) {
        return null;
      }
      // Generation check (stage 3): a hook post is bound to ONE process, so a
      // session other than the pane's current one belongs to a previous
      // occupant — unless nothing has named the current one yet. A server
      // event is bound to a PORT, and one opencode TUI runs several sessions,
      // so it rotates the pane's session rather than being refused.
      if (
        signal.source === "hook" &&
        prev.sessionId !== null &&
        prev.sessionId !== signal.sessionId &&
        signal.kind !== "session"
      ) {
        return null;
      }
      return commit(id, prev, reduceContract(prev, signal));
    },

    noteMintedSession(id, sessionId) {
      const prev = panes.get(id) ?? freshState();
      // Not a visible change: nothing on screen moves until the gate opens
      // and the id becomes the pane's session.
      panes.set(id, { ...prev, pendingSessionId: sessionId });
    },

    tick(now) {
      const changed: number[] = [];
      for (const [id, prev] of panes) {
        if (!prev.isAgent || prev.contractAt === null) {
          continue;
        }
        if (now - prev.contractAt <= CONTRACT_FRESHNESS_MS) {
          continue;
        }
        const contractAttention =
          prev.attention !== "none" && (prev.source === "hook" || prev.source === "server");
        const staleConfidence = contractAttention && prev.confidence === "explicit";
        const stalePhase = prev.phaseFromContract && prev.phaseConfidence === "explicit";
        if (!staleConfidence && !stalePhase) {
          continue;
        }
        // The state stays — a stale `requested` is still the last thing the
        // CLI said — but the mark turns hollow: it is a memory now, not a
        // report, and the process table and OSC are back in charge.
        const snap = commit(id, prev, {
          ...prev,
          confidence: staleConfidence ? "inferred" : prev.confidence,
          phaseConfidence: stalePhase ? "inferred" : prev.phaseConfidence,
          contractAt: null,
        });
        if (snap !== null) {
          changed.push(id);
        }
      }
      return changed;
    },

    acknowledge(id) {
      const prev = panes.get(id);
      if (prev === undefined) {
        return null;
      }
      const cleared: PaneState = {
        ...prev,
        attention: "none",
        source: null,
        confidence: "explicit",
        detail: null,
        unread: false,
      };
      // Focusing a pane whose agent ended is how the user checks it, the
      // same way focus is how a finished run gets checked: the row goes back
      // to being the shell it now is.
      const candidate = prev.phase === "exited" && !prev.isAgent ? checkedEnd(cleared) : cleared;
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
