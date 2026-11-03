/**
 * Main's copy of each pane's attention state (spec 2026-11-03-agent-orchestration, ORC14-15,
 * ORC17-18).
 *
 * The renderer owns phase and attention and reports every change through
 * `pane_attention_report`; this module only keeps the latest report per pane and lets a caller
 * wait for it to change. Main never classifies a phase itself, so `deck pane wait` is a wait on
 * the same hook-backed state the rail draws, not a poll of the screen.
 *
 * Pure: the clock is injected and nothing here touches Electron, so every branch of `wait` is
 * tested with fake timers.
 */
import type { PaneAttentionReport } from "../../src/lib/pane-attention-report";

/** A `working` report this old is likely a missed update, so it reads `inferred` (ORC18). */
export const STALE_WORKING_MS = 120_000;
/** After a send, this long with no `working` report means the agent took no turn (ORC15). */
export const NO_TURN_MS = 5_000;

export type PaneSnapshot = Omit<PaneAttentionReport, "paneId"> & {
  /** When main received the report, on the injected clock. */
  readonly reportedAt: number;
};

export type WaitTarget = "idle" | "needs-you" | "exited" | "turn";

export type WaitResult =
  | { readonly reached: true; readonly state: PaneSnapshot }
  | { readonly reached: false; readonly reason: "cap" | "no-turn" | "gone" };

export interface WaitOptions {
  /** Give up with `cap` after this long. */
  readonly capMs: number;
  /**
   * The pane's revision when a send was made (ORC15). The state that preceded the send cannot
   * satisfy the wait: a turn must have started after it.
   */
  readonly afterRevision?: number;
  /**
   * When that send was made, on the mirror's clock. The no-turn deadline is `sentAt + NO_TURN_MS`,
   * so a wait that starts late (the shim asks again in slices) gets no fresh grace period. Absent
   * = the moment `wait` is called.
   */
  readonly sentAt?: number;
  /** Ends the wait early with `cap` and clears its timers, for a caller that hung up. */
  readonly signal?: AbortSignal;
}

export interface PaneMirror {
  /** Keep the latest report for a pane and wake its waiters. */
  report(paneId: number, report: Omit<PaneSnapshot, "reportedAt">): void;
  /** The latest report, `inferred` when it says `working` and is stale; null when none came. */
  get(paneId: number): PaneSnapshot | null;
  /** Drop the pane; its waiters answer `gone`. */
  forget(paneId: number): void;
  /** How many reports this pane has had; 0 for a pane main has never heard of. */
  revisionOf(paneId: number): number;
  wait(paneId: number, target: WaitTarget, options: WaitOptions): Promise<WaitResult>;
}

interface PaneRecord {
  readonly snapshot: PaneSnapshot;
  readonly revision: number;
  /** The revision of the newest `working` report; 0 when there was none. */
  readonly lastWorkingRevision: number;
}

interface Waiter {
  evaluate(): void;
  gone(): void;
}

/** Attention that asks for the user: the coordinator must not answer it by itself. */
function blocking(attention: PaneSnapshot["attention"]): boolean {
  return attention === "requested" || attention === "warning" || attention === "error";
}

function targetMet(state: PaneSnapshot, target: WaitTarget): boolean {
  const done = state.phase === "idle" || state.phase === "exited";
  const idle = done && !blocking(state.attention);
  const needsYou = blocking(state.attention) || state.phase === "exited";
  switch (target) {
    case "idle":
      return idle;
    case "needs-you":
      return needsYou;
    case "exited":
      return state.phase === "exited";
    case "turn":
      return idle || needsYou;
  }
}

/**
 * Whether the pane has been working since a send made at `afterRevision`: a `working` report
 * came after it, or the report that was current at the send was itself `working` (the text
 * reached a pane already mid-turn). Read from the newest `working` revision alone, so it holds
 * across the shim's re-asks and for a turn that ended before the wait asked.
 */
function turnStartedSince(record: PaneRecord | undefined, afterRevision: number): boolean {
  const last = record?.lastWorkingRevision ?? 0;
  return last > 0 && last >= afterRevision;
}

/**
 * Whether a report after the send left the agent or asked for the user. That ends a wait even
 * with no `working` report in between, and it is not silence either: the agent did something.
 */
function endedSince(record: PaneRecord | undefined, afterRevision: number): boolean {
  if (record === undefined) return false;
  const { phase, attention } = record.snapshot;
  return record.revision > afterRevision && (phase === "exited" || blocking(attention));
}

export function createPaneMirror(options: { readonly now: () => number }): PaneMirror {
  const records = new Map<number, PaneRecord>();
  const waiters = new Map<number, Set<Waiter>>();

  function view(record: PaneRecord): PaneSnapshot {
    const stale =
      record.snapshot.phase === "working" &&
      options.now() - record.snapshot.reportedAt > STALE_WORKING_MS;
    return stale ? { ...record.snapshot, confidence: "inferred" } : record.snapshot;
  }

  /** The state that satisfies the wait, or null. ORC15 applies when `afterRevision` is given. */
  function satisfying(
    record: PaneRecord | undefined,
    target: WaitTarget,
    afterRevision: number | undefined,
  ): PaneSnapshot | null {
    if (record === undefined) return null;
    const state = view(record);
    if (!targetMet(state, target)) return null;
    if (afterRevision === undefined) return state;
    return turnStartedSince(record, afterRevision) || endedSince(record, afterRevision)
      ? state
      : null;
  }

  return {
    report(paneId, report) {
      const previous = records.get(paneId);
      const revision = (previous?.revision ?? 0) + 1;
      records.set(paneId, {
        snapshot: { ...report, reportedAt: options.now() },
        revision,
        lastWorkingRevision:
          report.phase === "working" ? revision : (previous?.lastWorkingRevision ?? 0),
      });
      // Copied: a waiter that settles removes itself from the set while it is walked.
      for (const waiter of [...(waiters.get(paneId) ?? [])]) waiter.evaluate();
    },
    get(paneId) {
      const record = records.get(paneId);
      return record === undefined ? null : view(record);
    },
    forget(paneId) {
      records.delete(paneId);
      const pending = [...(waiters.get(paneId) ?? [])];
      waiters.delete(paneId);
      for (const waiter of pending) waiter.gone();
    },
    revisionOf(paneId) {
      return records.get(paneId)?.revision ?? 0;
    },
    wait(paneId, target, { capMs, afterRevision, sentAt, signal }) {
      return new Promise<WaitResult>((resolve) => {
        let capTimer: ReturnType<typeof setTimeout> | undefined;
        let noTurnTimer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        // The agent has until here to start a turn. Counted from the send, not from this call.
        const noTurnAt =
          afterRevision === undefined ? null : (sentAt ?? options.now()) + NO_TURN_MS;
        let noTurnDue = noTurnAt !== null && options.now() >= noTurnAt;
        const waiter: Waiter = { evaluate, gone: () => finish({ reached: false, reason: "gone" }) };

        function finish(result: WaitResult): void {
          if (settled) return;
          settled = true;
          clearTimeout(capTimer);
          clearTimeout(noTurnTimer);
          signal?.removeEventListener("abort", onAbort);
          const set = waiters.get(paneId);
          set?.delete(waiter);
          if (set?.size === 0) waiters.delete(paneId);
          resolve(result);
        }
        function evaluate(): void {
          const record = records.get(paneId);
          const state = satisfying(record, target, afterRevision);
          if (state !== null) {
            finish({ reached: true, state });
            return;
          }
          // Past the deadline, the only thing that keeps the wait alive is a turn: a `working`
          // report since the send (a pane already mid-turn at the send counts), or the agent
          // leaving or asking for the user. An attention change alone, such as `completed` turning
          // `none` when the user focuses the pane, is not a turn and cancels nothing.
          if (
            noTurnDue &&
            afterRevision !== undefined &&
            !turnStartedSince(record, afterRevision) &&
            !endedSince(record, afterRevision)
          ) {
            finish({ reached: false, reason: "no-turn" });
          }
        }
        function onAbort(): void {
          finish({ reached: false, reason: "cap" });
        }

        if (signal?.aborted === true) return onAbort();
        evaluate();
        if (settled) return;

        let set = waiters.get(paneId);
        if (set === undefined) {
          set = new Set();
          waiters.set(paneId, set);
        }
        set.add(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        capTimer = setTimeout(() => finish({ reached: false, reason: "cap" }), capMs);
        if (noTurnAt !== null && !noTurnDue) {
          noTurnTimer = setTimeout(() => {
            // A flag, not a clock comparison: a timer may fire a hair before `now()` reaches the
            // deadline, and a missed check would leave the wait to run to its cap.
            noTurnDue = true;
            evaluate();
          }, noTurnAt - options.now());
        }
      });
    },
  };
}
