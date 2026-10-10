/**
 * When the Changes list reads again (plan 2026-10-10-changes-list, C4, C5).
 *
 * Every trigger — a watch event, a pane leaving `working`, focus, the list
 * appearing, Refresh — feeds this one pure scheduler, so the whole policy is
 * testable with fake timers and nothing else decides when git runs:
 *
 *  - Watch events and turn ends are debounced 150 ms, trailing, but never
 *    longer than 1,000 ms from a burst's first trigger, so a long `npm install`
 *    still reads about once a second.
 *  - A read starts no sooner than 1,000 ms after the previous read started and
 *    one previous-duration after it ended, so a slow repository is not hammered.
 *  - Focus, the list appearing and Refresh skip the debounce and that spacing.
 *  - One read is in flight at most. Triggers that arrive during it collapse
 *    into exactly one more.
 *  - While inactive (window hidden, list not shown) timers are cancelled and
 *    triggers are dropped; becoming active reads once.
 */

export const DEBOUNCE_MS = 150;
export const MAX_WAIT_MS = 1000;
export const MIN_INTERVAL_MS = 1000;

export type TriggerKind = "watch" | "turn-end" | "focus" | "shown" | "refresh";

const IMMEDIATE: ReadonlySet<TriggerKind> = new Set(["focus", "shown", "refresh"]);

export interface SchedulerClock {
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** Looked up at call time so fake timers installed after import still apply. */
const realClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ChangesScheduler {
  trigger(kind: TriggerKind): void;
  setActive(active: boolean): void;
  dispose(): void;
}

interface Pending {
  readonly first: number;
  last: number;
  immediate: boolean;
}

export function createChangesScheduler(deps: {
  /** Performs one read. Must not reject; a rejection is swallowed. */
  readonly read: () => Promise<void>;
  readonly clock?: SchedulerClock;
}): ChangesScheduler {
  const clock = deps.clock ?? realClock;
  let active = false;
  let pending: Pending | null = null;
  let timer: unknown = null;
  let inFlight = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let lastEnd = Number.NEGATIVE_INFINITY;
  let lastDuration = 0;

  const cancelTimer = (): void => {
    if (timer !== null) {
      clock.clearTimer(timer);
      timer = null;
    }
  };

  const start = (): void => {
    pending = null;
    inFlight = true;
    lastStart = clock.now();
    let settled: Promise<void>;
    try {
      settled = deps.read();
    } catch {
      settled = Promise.resolve();
    }
    void settled
      .catch(() => {})
      .then(() => {
        lastEnd = clock.now();
        lastDuration = lastEnd - lastStart;
        inFlight = false;
        schedule();
      });
  };

  function schedule(): void {
    if (!active || pending === null || inFlight) {
      return;
    }
    cancelTimer();
    const now = clock.now();
    let due = now;
    if (!pending.immediate) {
      due = Math.min(pending.last + DEBOUNCE_MS, pending.first + MAX_WAIT_MS);
      due = Math.max(due, lastStart + MIN_INTERVAL_MS, lastEnd + lastDuration);
    }
    if (due <= now) {
      start();
      return;
    }
    timer = clock.setTimer(() => {
      timer = null;
      schedule();
    }, due - now);
  }

  const trigger = (kind: TriggerKind): void => {
    if (!active) {
      return;
    }
    const now = clock.now();
    const immediate = IMMEDIATE.has(kind);
    if (pending === null) {
      pending = { first: now, last: now, immediate };
    } else {
      pending.last = now;
      pending.immediate = pending.immediate || immediate;
    }
    schedule();
  };

  return {
    trigger,
    setActive(next) {
      if (next === active) {
        return;
      }
      active = next;
      if (!active) {
        cancelTimer();
        pending = null;
        return;
      }
      trigger("shown");
    },
    dispose() {
      active = false;
      cancelTimer();
      pending = null;
    },
  };
}
