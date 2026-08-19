import { parseProgressEvents, type OscProgressEvent } from "../lib/osc-progress";

/**
 * Per-pane "is the program actually working?" tracker, fed from raw PTY
 * output. Two signals, most precise first:
 *
 * 1. OSC 9;4 progress reports (Claude Code emits these once the PTY env
 *    advertises support — see pty.rs; Ghostty renders the same reports as its
 *    native progress bar). Once a pane has emitted one, it is the sole source
 *    of truth for that pane — non-zero state means working. Reports are
 *    parsed from EVERY chunk, even echo (Enter is input, and the busy report
 *    lands right behind it).
 * 2. A heuristic fallback for programs that never report progress
 *    (codex/gemini, and agy until observed otherwise — it is a closed-source
 *    binary, so nothing can be asserted about its OSC output from reading it):
 *    working = a SUSTAINED stream of output — at least
 *    `minStreakMs` of continuous activity, still fresh within `recentMs` —
 *    where output arriving within `echoMs` of the user's own keystrokes is
 *    ignored (it's the TUI echoing input, not work), and a single isolated
 *    repaint (idle status refresh) never counts because its span is ~0ms.
 *
 * The caller gates this with the explicit process classification — a chatty
 * shell job never reaches the spinner without `kind: "agent"`.
 */
export interface AgentActivity {
  /** Feed one PTY output chunk. True when the pane's working state flipped. */
  noteOutput(paneId: number, chunk: string): boolean;
  /**
   * Feed one PTY output chunk, returning every activity transition it
   * produced, in order. OSC 9;4 reports (when present) are the sole source —
   * one transition per event, even when the pane returns to idle within the
   * same chunk. A pane that has never reported OSC falls back to the
   * sustained-output heuristic, emitting at most one transition (on flip).
   */
  noteOutputEvents(paneId: number, chunk: string): ActivityTransition[];
  /** The user wrote to this pane (keystroke/paste) — starts an echo window. */
  noteInput(paneId: number): void;
  /**
   * Foreground process of the pane as last polled. A change (agent exited to
   * the shell, a new agent started) resets the pane's record so a stale OSC
   * "busy" from a killed process can't pin the spinner on forever.
   */
  noteProcess(paneId: number, process: string | null): void;
  /** Is this pane working right now? Unknown panes are not. */
  working(paneId: number): boolean;
  /** The pane's current typed snapshot. Unknown until it produces a signal. */
  snapshot(paneId: number): ActivitySnapshot;
  /** Forget every pane outside `live` — call after a pane/tab closes. */
  prune(live: readonly number[]): void;
}

/** Coarse lifecycle phase derived from a pane's activity signal. */
export type AgentPhase = "unknown" | "idle" | "working" | "exited";

/** Which signal produced the current phase/severity. */
export type ActivitySource = "osc-progress" | "output-heuristic";

/** OSC state 2 → error, state 4 → warning; everything else has none. */
export type ActivitySeverity = "warning" | "error" | null;

/** One ordered activity transition emitted by `noteOutputEvents`. */
export interface ActivityTransition {
  phase: AgentPhase;
  source: ActivitySource;
  severity: ActivitySeverity;
  /** Raw numeric OSC state; null for the output-heuristic fallback. */
  oscState: number | null;
  observedAt: number;
  /** Fallback only: when the sustained-output streak behind this flip began. */
  evidenceStartedAt?: number;
}

/** A pane's current activity state, as returned by `snapshot`. */
export interface ActivitySnapshot {
  phase: AgentPhase;
  source: ActivitySource | null;
  severity: ActivitySeverity;
  oscState: number | null;
}

interface PaneRecord {
  /** Trailing bytes of the last chunk — catches OSC split across reads. */
  carry: string;
  /** Last OSC 9;4 state; null until the pane first reports progress. */
  oscState: number | null;
  /** Start of the current non-echo output streak (fallback signal). */
  streakStart: number;
  lastOutputAt: number;
  lastInputAt: number;
  lastProcess: string | null;
}

const DEFAULT_RECENT_MS = 3000;
const DEFAULT_ECHO_MS = 300;
const DEFAULT_STREAK_GAP_MS = 1200;
const DEFAULT_MIN_STREAK_MS = 400;

export interface AgentActivityOptions {
  /** Injectable clock for tests. */
  now?: () => number;
  /** How long after the last output a working pane still counts as working. */
  recentMs?: number;
  /** Output arriving this soon after user input is echo, not work. */
  echoMs?: number;
  /** A silence longer than this starts a new streak. */
  streakGapMs?: number;
  /** A streak must span at least this long before it reads as working. */
  minStreakMs?: number;
}

function freshRecord(): PaneRecord {
  return {
    carry: "",
    oscState: null,
    streakStart: 0,
    lastOutputAt: 0,
    lastInputAt: 0,
    lastProcess: null,
  };
}

/**
 * Derive phase/severity from a raw OSC 9;4 state. The raw state itself is
 * never narrowed by this mapping — callers keep `oscState` as-is, including
 * unknown future states, which fall through to `working`/`null` here.
 */
function deriveFromOscState(oscState: number): {
  phase: AgentPhase;
  severity: ActivitySeverity;
} {
  if (oscState === 0) {
    return { phase: "idle", severity: null };
  }
  if (oscState === 2) {
    return { phase: "working", severity: "error" };
  }
  if (oscState === 4) {
    return { phase: "working", severity: "warning" };
  }
  return { phase: "working", severity: null };
}

/** Result of feeding one chunk through the shared OSC/fallback bookkeeping. */
interface ApplyChunkResult {
  /** OSC 9;4 events found in this chunk, in order. Empty when none arrived. */
  events: OscProgressEvent[];
  /**
   * True when the sustained-output fallback bookkeeping actually ran for
   * this call (only a pane that has never reported OSC, on a chunk that
   * itself carried no OSC events).
   */
  usedFallback: boolean;
}

/**
 * Shared mutation step behind both `noteOutput` and `noteOutputEvents`: parse
 * OSC 9;4 events out of the chunk (updating `record.carry`/`record.oscState`)
 * and, only for a pane that has never reported OSC, run the echo-suppression
 * / streak bookkeeping that feeds the sustained-output fallback. OSC beats
 * fallback — once a pane has ever reported a state, fallback bookkeeping
 * stops (it can no longer affect `isWorking`, which reads `oscState` first).
 */
function applyChunk(
  record: PaneRecord,
  chunk: string,
  at: number,
  echoMs: number,
  streakGapMs: number,
): ApplyChunkResult {
  const { events, carry } = parseProgressEvents(record.carry, chunk);
  record.carry = carry;
  if (events.length > 0) {
    for (const event of events) {
      record.oscState = event.state;
    }
    return { events, usedFallback: false };
  }
  if (record.oscState !== null) {
    return { events: [], usedFallback: false };
  }
  // Echo suppression applies only to the fallback bookkeeping: output on the
  // heels of a keystroke is the TUI redrawing its input box.
  if (at - record.lastInputAt >= echoMs) {
    if (at - record.lastOutputAt > streakGapMs) {
      record.streakStart = at; // silence ended — a new streak begins
    }
    record.lastOutputAt = at;
  }
  return { events: [], usedFallback: true };
}

export function createAgentActivity(options: AgentActivityOptions = {}): AgentActivity {
  const now = options.now ?? Date.now;
  const recentMs = options.recentMs ?? DEFAULT_RECENT_MS;
  const echoMs = options.echoMs ?? DEFAULT_ECHO_MS;
  const streakGapMs = options.streakGapMs ?? DEFAULT_STREAK_GAP_MS;
  const minStreakMs = options.minStreakMs ?? DEFAULT_MIN_STREAK_MS;
  const panes = new Map<number, PaneRecord>();

  function isWorking(record: PaneRecord | undefined, at: number): boolean {
    if (record === undefined) {
      return false;
    }
    if (record.oscState !== null) {
      return record.oscState !== 0;
    }
    return (
      record.lastOutputAt !== 0 &&
      at - record.lastOutputAt < recentMs &&
      record.lastOutputAt - record.streakStart >= minStreakMs
    );
  }

  function getOrCreate(paneId: number): PaneRecord {
    let record = panes.get(paneId);
    if (record === undefined) {
      record = freshRecord();
      panes.set(paneId, record);
    }
    return record;
  }

  return {
    noteOutput(paneId, chunk) {
      const record = getOrCreate(paneId);
      const at = now();
      const before = isWorking(record, at);
      // OSC reports are parsed from every chunk — Enter is user input, and
      // the "busy" report rides the redraw that follows it immediately.
      applyChunk(record, chunk, at, echoMs, streakGapMs);
      return isWorking(record, at) !== before;
    },
    noteOutputEvents(paneId, chunk) {
      const record = getOrCreate(paneId);
      const at = now();
      const before = isWorking(record, at);
      const { events, usedFallback } = applyChunk(record, chunk, at, echoMs, streakGapMs);
      if (events.length > 0) {
        return events.map((event): ActivityTransition => {
          const { phase, severity } = deriveFromOscState(event.state);
          return {
            phase,
            source: "osc-progress",
            severity,
            oscState: event.state,
            observedAt: at,
          };
        });
      }
      if (!usedFallback) {
        return [];
      }
      const after = isWorking(record, at);
      if (after === before) {
        return [];
      }
      return [
        {
          phase: after ? "working" : "idle",
          source: "output-heuristic",
          severity: null,
          oscState: null,
          observedAt: at,
          evidenceStartedAt: record.streakStart,
        },
      ];
    },
    noteInput(paneId) {
      getOrCreate(paneId).lastInputAt = now();
    },
    noteProcess(paneId, process) {
      const record = getOrCreate(paneId);
      if (record.lastProcess === process) {
        return;
      }
      const hadProcess = record.lastProcess !== null;
      record.lastProcess = process;
      if (hadProcess) {
        // The pane's program changed under us — everything the old program
        // reported (or streamed) is stale.
        record.oscState = null;
        record.streakStart = 0;
        record.lastOutputAt = 0;
        record.carry = "";
      }
    },
    working(paneId) {
      return isWorking(panes.get(paneId), now());
    },
    snapshot(paneId) {
      const record = panes.get(paneId);
      if (record === undefined) {
        return {
          phase: "unknown",
          source: null,
          severity: null,
          oscState: null,
        };
      }
      if (record.oscState !== null) {
        const { phase, severity } = deriveFromOscState(record.oscState);
        return {
          phase,
          source: "osc-progress",
          severity,
          oscState: record.oscState,
        };
      }
      // No OSC ever reported. A record with no output signal either (e.g.
      // fresh, or just reset by `noteProcess`) has produced no signal yet.
      if (record.lastOutputAt === 0) {
        return {
          phase: "unknown",
          source: null,
          severity: null,
          oscState: null,
        };
      }
      return {
        phase: isWorking(record, now()) ? "working" : "idle",
        source: "output-heuristic",
        severity: null,
        oscState: null,
      };
    },
    prune(live) {
      const keep = new Set(live);
      for (const id of panes.keys()) {
        if (!keep.has(id)) {
          panes.delete(id);
        }
      }
    },
  };
}
