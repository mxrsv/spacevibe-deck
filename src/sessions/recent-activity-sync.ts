/**
 * Keeping Recent activity current.
 *
 * The block used to load once, at boot: an agent answering in a pane two
 * minutes later left the sidebar quoting a sentence it had already replaced,
 * and the only way to see the new one was to restart Deck.
 *
 * It is driven by the signals that already move when a session log is written,
 * never by a bare interval — the same rule
 * [`session-tail-store.ts`](../terminal/session-tail-store.ts) is built on:
 *
 * - **`paneTails`** changes when the tail store has just read a NEW sentence
 *   off disk. That is the tightest evidence available that a session file grew.
 * - **`tabViews`** changes when a pane appears, exits or moves state, which is
 *   what starts a conversation the list has never seen.
 * - **window focus** covers the one case no in-window signal can: a session
 *   advanced in ANOTHER Deck window, or in an agent CLI running outside Deck.
 *
 * Two throttles keep the cost honest, because a refresh is a real scan on the
 * process that owns every PTY (two directory walks plus head reads, in
 * `electron/sessions/list.ts`): a `DEBOUNCE_MS` quiet period so a burst of pane
 * updates is one refresh, and a `MIN_INTERVAL_MS` floor between two refreshes
 * so a long agent run cannot turn the sidebar into a poller.
 *
 * Window-scoped module store (R5). Inert on a host with no sessions support —
 * the boot load is what decides that, and a `false` answer stops the sync
 * rather than re-asking a host that has already said no.
 */
import { effect } from "@preact/signals";
import { paneTails } from "../terminal/session-tail-store";
import { tabViews } from "../terminal/tabs-store";
import { refreshRecentSessions, sessionsSupported } from "./sessions-store";

/** A burst of pane updates is one refresh. */
const DEBOUNCE_MS = 600;
/** Floor between two scans, however loud the signals are. */
const MIN_INTERVAL_MS = 4_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastRunAt = 0;
let running = false;
/** A signal arrived while a scan was in flight; run once more when it lands. */
let queued = false;

function cancelTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

async function run(): Promise<void> {
  if (!sessionsSupported.peek()) {
    return;
  }
  if (running) {
    queued = true;
    return;
  }
  running = true;
  lastRunAt = Date.now();
  try {
    await refreshRecentSessions();
  } finally {
    running = false;
    lastRunAt = Date.now();
    if (queued) {
      queued = false;
      schedule();
    }
  }
}

/**
 * Wait out the debounce, and then the remainder of the interval floor. The
 * delay is computed from when the LAST scan finished, so a slow scan pushes the
 * next one out rather than queueing behind itself.
 */
function schedule(): void {
  const sinceLast = Date.now() - lastRunAt;
  const delay = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - sinceLast);
  cancelTimer();
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, delay);
}

/**
 * Load the block once and keep it current. Returns its own disposer, so the
 * caller is one `useEffect` line.
 */
export function installRecentActivitySync(): () => void {
  // The boot load, which is also what answers "does this host have sessions".
  lastRunAt = Date.now();
  void refreshRecentSessions();

  // The effect's FIRST run is its subscription pass, not a change: without
  // this the boot load would be followed by a second scan an interval later,
  // every launch, on evidence that nothing had happened.
  let subscribed = false;
  const disposeSignals = effect(() => {
    // The two dependencies, read for their identity only — and read BEFORE the
    // early return, or the first pass would subscribe to nothing.
    void paneTails.value;
    void tabViews.value;
    if (!subscribed) {
      subscribed = true;
      return;
    }
    schedule();
  });

  const onFocus = (): void => {
    schedule();
  };
  window.addEventListener("focus", onFocus);

  return () => {
    disposeSignals();
    window.removeEventListener("focus", onFocus);
    cancelTimer();
    queued = false;
  };
}

/** Tests only. */
export function resetRecentActivitySync(): void {
  cancelTimer();
  lastRunAt = 0;
  running = false;
  queued = false;
}
