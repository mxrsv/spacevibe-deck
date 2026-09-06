/**
 * The usage-analytics service: consent, daily buffers, and sending.
 *
 * The consent policy is stated once, in `src/telemetry/usage-notice.ts` and
 * docs/internals/telemetry.md; `parsePersisted` and `consentNow` below are
 * its implementation. Everything is injected (`post`, `now`, the store, the timer) the way
 * `createUpdateLifecycle` injects `loadUpdater`, so no test touches the
 * network or the clock. The governing failure rule is that a dead Worker must
 * be indistinguishable from a healthy one from inside the app: no caller ever
 * awaits a POST, and no state the UI reads depends on one.
 */
import {
  AGENT_PAYLOAD_KEYS,
  CONSENT_VERSION,
  COUNTER_CAP,
  EMPTY_STATE,
  HEARTBEAT_INTERVAL_MS,
  MAX_PENDING_DAYS,
  SCHEMA_VERSION,
  SEND_CHECK_INTERVAL_MS,
  SURFACE_KEYS,
  type ConsentState,
  type CountKind,
  type DayBuffer,
  type PersistedTelemetry,
  type TelemetryStateReply,
  type UsagePayloadLike,
} from "./model";

export interface TelemetryStoreAccess {
  /** True when `telemetry.json` exists but could not be read — fail closed. */
  unreadable(): boolean;
  /** The persisted state value, raw; validated by `parsePersisted`. */
  read(): unknown;
  /** Debounced background save — counter folds ride this. */
  write(state: PersistedTelemetry): void;
  /** Awaited save — consent changes only persist through this. */
  flush(state: PersistedTelemetry): Promise<void>;
}

export interface TelemetryDeps {
  now(): number;
  /** The client's LOCAL calendar day for an epoch ms — "YYYY-MM-DD". */
  localDay(nowMs: number): string;
  randomUUID(): string;
  /** Resolves the HTTP status; rejects on network failure or timeout. */
  post(payload: UsagePayloadLike): Promise<number>;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
  readonly store: TelemetryStoreAccess;
  report(message: string, error: unknown): void;
  /** Fan-out to every window when consent state changes. */
  onStateChanged?(state: TelemetryStateReply): void;
  /** Injectable interval for tests; returns the stopper. */
  startTimer?(handler: () => void, intervalMs: number): () => void;
}

export interface TelemetryService {
  count(kind: string, key: string, value: number): void;
  state(): TelemetryStateReply;
  setEnabled(enabled: boolean): Promise<void>;
  /** First window ready in an enabled run — the initial snapshot. */
  noteWindowReady(): void;
  /** Best-effort final snapshot during orderly quit. Never throws. */
  flushOnQuit(): Promise<void>;
  dispose(): void;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseCounters(raw: unknown, allowed: readonly string[]): Record<string, number> {
  const counters: Record<string, number> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return counters;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (allowed.includes(key) && isCount(value)) {
      counters[key] = Math.min(value, COUNTER_CAP);
    }
  }
  return counters;
}

function parseBuffer(raw: unknown): DayBuffer | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.dailyId !== "string" || source.dailyId.length === 0) {
    return null;
  }
  return {
    dailyId: source.dailyId,
    agents: parseCounters(source.agents, AGENT_PAYLOAD_KEYS),
    surfaces: parseCounters(source.surfaces, SURFACE_KEYS),
    maxTabs: isCount(source.maxTabs) ? Math.min(source.maxTabs, COUNTER_CAP) : 0,
    maxPanes: isCount(source.maxPanes) ? Math.min(source.maxPanes, COUNTER_CAP) : 0,
    restoredSessions: source.restoredSessions === true,
    dirty: source.dirty === true,
    lastSentAt: isCount(source.lastSentAt) ? source.lastSentAt : null,
    terminal: source.terminal === true,
  };
}

/**
 * Validate persisted state from disk.
 *
 * `declined` is the only value that survives a round trip unchanged, and that
 * asymmetry is the whole rule since analytics went on by default (2026-08-23):
 * OFF is a state only the user can put the app in, so it is never inferred
 * away. Everything else — a missing field, a garbage string, or the
 * `unanswered` an opt-in build left behind — reads as the new default.
 *
 * A file that cannot be READ at all is a different answer: `consentNow` reports
 * `unreadable` and nothing is sent, because a disk Deck cannot read is not a
 * disk it may assume a preference from.
 */
export function parsePersisted(raw: unknown): PersistedTelemetry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return EMPTY_STATE;
  }
  const source = raw as Record<string, unknown>;
  const consent = source.consent === "declined" ? "declined" : "enabled";
  const consentVersion = isCount(source.consentVersion) ? source.consentVersion : 0;
  const days: Record<string, DayBuffer> = {};
  const rawDays = source.days;
  if (typeof rawDays === "object" && rawDays !== null && !Array.isArray(rawDays)) {
    for (const [day, value] of Object.entries(rawDays)) {
      const buffer = parseBuffer(value);
      if (buffer !== null && DAY_PATTERN.test(day)) {
        days[day] = buffer;
      }
    }
  }
  return { consent, consentVersion, days };
}

/**
 * Whether TODAY's buffer is due: never-sent sends now, a dirty one
 * at most every 15 minutes, and a clean one on the six-hour heartbeat.
 * Pure and exported so the cadence is tested without a timer.
 */
export function shouldSend(buffer: DayBuffer, nowMs: number, consent: ConsentState): boolean {
  if (consent !== "enabled" || buffer.terminal) {
    return false;
  }
  if (buffer.lastSentAt === null) {
    return true;
  }
  if (buffer.dirty && nowMs - buffer.lastSentAt >= SEND_CHECK_INTERVAL_MS) {
    return true;
  }
  return nowMs - buffer.lastSentAt >= HEARTBEAT_INTERVAL_MS;
}

export function createTelemetryService(deps: TelemetryDeps): TelemetryService {
  let state: PersistedTelemetry = deps.store.unreadable()
    ? EMPTY_STATE
    : parsePersisted(deps.store.read());
  let stopTimer: (() => void) | null = null;
  let sending = false;
  let initialSnapshotDone = false;

  const startTimer =
    deps.startTimer ??
    ((handler: () => void, intervalMs: number): (() => void) => {
      const timer = setInterval(handler, intervalMs);
      // Never keep the process alive for analytics.
      timer.unref?.();
      return () => clearInterval(timer);
    });

  function consentNow(): ConsentState {
    if (deps.store.unreadable()) {
      return "unreadable";
    }
    // The version downgrade went with the question (2026-08-23). It existed to
    // return an installation to `unanswered` when the contract changed, so the
    // user could be asked again; with nothing left to ask, returning a state
    // that renders nothing would only stop collection silently and forever.
    // A material payload or purpose change is now a DOCUMENT change — the
    // privacy notice's own effective date — not a state machine here.
    return state.consent;
  }

  function enabled(): boolean {
    return consentNow() === "enabled";
  }

  function persist(): void {
    try {
      deps.store.write(state);
    } catch (error: unknown) {
      // A write-locked store: the fold stays in memory for this run.
      deps.report("telemetry state write blocked", error);
    }
  }

  /** Keep at most the newest MAX_PENDING_DAYS buffers. */
  function pruneDays(days: Record<string, DayBuffer>): Record<string, DayBuffer> {
    const ordered = Object.keys(days).sort();
    while (ordered.length > MAX_PENDING_DAYS) {
      const oldest = ordered.shift();
      if (oldest !== undefined) {
        const { [oldest]: _dropped, ...rest } = days;
        days = rest;
      }
    }
    return days;
  }

  /**
   * Resume or create the current local day's buffer. Returning to a date
   * after a timezone change reuses that buffer's id and counters, so the
   * server upsert replaces the same row.
   */
  function ensureToday(): string {
    const today = deps.localDay(deps.now());
    if (state.days[today] === undefined) {
      const days = pruneDays({
        ...state.days,
        [today]: {
          dailyId: deps.randomUUID(),
          agents: {},
          surfaces: {},
          maxTabs: 0,
          maxPanes: 0,
          restoredSessions: false,
          dirty: true,
          lastSentAt: null,
          terminal: false,
        },
      });
      state = { ...state, days };
      persist();
    }
    return today;
  }

  function updateDay(day: string, buffer: DayBuffer): void {
    state = { ...state, days: { ...state.days, [day]: buffer } };
  }

  function removeDay(day: string): void {
    const { [day]: _removed, ...rest } = state.days;
    state = { ...state, days: rest };
  }

  function buildPayload(day: string, buffer: DayBuffer): UsagePayloadLike {
    const agents: Record<string, number> = {};
    for (const [key, value] of Object.entries(buffer.agents)) {
      if (value > 0) {
        agents[key] = value;
      }
    }
    const surfaces: Record<string, number> = {};
    for (const key of SURFACE_KEYS) {
      surfaces[key] = buffer.surfaces[key] ?? 0;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      dailyId: buffer.dailyId,
      day,
      version: deps.version,
      platform: deps.platform,
      arch: deps.arch,
      agents,
      surfaces,
      maxTabs: buffer.maxTabs,
      maxPanes: buffer.maxPanes,
      restoredSessions: buffer.restoredSessions,
    };
  }

  async function runSendCycle(): Promise<void> {
    if (sending || !enabled()) {
      return;
    }
    sending = true;
    try {
      const today = ensureToday();
      for (const day of Object.keys(state.days).sort()) {
        const buffer = state.days[day];
        if (buffer === undefined) {
          continue;
        }
        const due =
          day === today
            ? shouldSend(buffer, deps.now(), "enabled")
            : // A past day is a final snapshot: retry until accepted or the
              // seven-day cap drops it. Already-delivered clean days are gone.
              !buffer.terminal && (buffer.dirty || buffer.lastSentAt === null);
        if (!due) {
          continue;
        }
        let status: number;
        try {
          status = await deps.post(buildPayload(day, buffer));
        } catch {
          // Network failure or timeout: keep the buffer, retry at the next
          // scheduled check. No backoff, no fast retry.
          continue;
        }
        if (status >= 200 && status < 300) {
          if (day === today) {
            // Re-read after the await: a count folded during the in-flight
            // POST replaced this day's object, and spreading the stale
            // `buffer` would erase that fold and clear `dirty`, losing the
            // count forever. A mid-flight fold keeps `dirty` so the next
            // cycle resends the fuller snapshot.
            const latest = state.days[day];
            if (latest !== undefined) {
              updateDay(day, {
                ...latest,
                dirty: latest !== buffer ? latest.dirty : false,
                lastSentAt: deps.now(),
              });
            }
          } else {
            removeDay(day);
          }
          persist();
        } else if (status === 400 || status === 413) {
          // The only client-invalid answers in the frozen contract: this
          // exact buffer must never be sent again.
          updateDay(day, { ...buffer, terminal: true });
          persist();
        }
        // 408/429/5xx and every other 4xx: keep the buffer under the cap.
      }
    } finally {
      sending = false;
    }
  }

  function beginTimer(): void {
    if (stopTimer === null) {
      stopTimer = startTimer(() => {
        void runSendCycle();
      }, SEND_CHECK_INTERVAL_MS);
    }
  }

  function endTimer(): void {
    stopTimer?.();
    stopTimer = null;
  }

  function notifyState(): void {
    deps.onStateChanged?.(replyState());
  }

  function replyState(): TelemetryStateReply {
    return { consent: consentNow(), consentVersion: state.consentVersion };
  }

  // Boot: an enabled run resumes or creates today's buffer and owns
  // its own timer. Every other consent state creates no id, accepts no count
  // and starts no network timer.
  if (enabled()) {
    ensureToday();
    beginTimer();
  }

  return {
    count(kind: string, key: string, value: number): void {
      if (!enabled()) {
        return;
      }
      // Main re-validates: the renderer is not the trust boundary.
      if (!isCount(value)) {
        return;
      }
      const amount = Math.min(value, COUNTER_CAP);
      const today = ensureToday();
      const buffer = state.days[today];
      if (buffer === undefined) {
        return;
      }
      const fold = (counters: Readonly<Record<string, number>>, name: string) => ({
        ...counters,
        [name]: Math.min((counters[name] ?? 0) + amount, COUNTER_CAP),
      });
      switch (kind as CountKind) {
        case "agent":
          if (!AGENT_PAYLOAD_KEYS.includes(key as (typeof AGENT_PAYLOAD_KEYS)[number])) {
            return;
          }
          updateDay(today, { ...buffer, agents: fold(buffer.agents, key), dirty: true });
          break;
        case "surface":
          if (!SURFACE_KEYS.includes(key as (typeof SURFACE_KEYS)[number])) {
            return;
          }
          updateDay(today, { ...buffer, surfaces: fold(buffer.surfaces, key), dirty: true });
          break;
        case "tabs":
          if (amount <= buffer.maxTabs) {
            return;
          }
          updateDay(today, { ...buffer, maxTabs: amount, dirty: true });
          break;
        case "panes":
          if (amount <= buffer.maxPanes) {
            return;
          }
          updateDay(today, { ...buffer, maxPanes: amount, dirty: true });
          break;
        case "restored":
          if (buffer.restoredSessions) {
            return;
          }
          updateDay(today, { ...buffer, restoredSessions: true, dirty: true });
          break;
        default:
          return;
      }
      persist();
    },

    state: replyState,

    async setEnabled(next: boolean): Promise<void> {
      if (deps.store.unreadable()) {
        // Fail closed: no consent is inferred and nothing is reset here.
        // Recovering requires the user to repair or remove the file.
        throw new Error("telemetry.json is unreadable; analytics stays off");
      }
      const previous = state;
      if (next) {
        // Consent persists FIRST; the daily id exists only after the write
        // succeeds. Turning on records the current consent version.
        state = { consent: "enabled", consentVersion: CONSENT_VERSION, days: {} };
        try {
          await deps.store.flush(state);
        } catch (error: unknown) {
          state = previous;
          throw error;
        }
        ensureToday();
        beginTimer();
        notifyState();
        void runSendCycle();
        return;
      }
      // Off means off: block timers and counts first, then delete
      // every unsent buffer and daily id, then persist the declined state.
      endTimer();
      state = { consent: "declined", consentVersion: CONSENT_VERSION, days: {} };
      try {
        await deps.store.flush(state);
      } catch (error: unknown) {
        // The declined in-memory state stands for this run — off stays off —
        // but the caller must surface that the change did not persist.
        notifyState();
        throw error;
      }
      notifyState();
    },

    noteWindowReady(): void {
      if (!enabled() || initialSnapshotDone) {
        return;
      }
      initialSnapshotDone = true;
      ensureToday();
      void runSendCycle();
    },

    async flushOnQuit(): Promise<void> {
      endTimer();
      if (!enabled()) {
        return;
      }
      const today = deps.localDay(deps.now());
      const buffer = state.days[today];
      if (
        buffer === undefined ||
        buffer.terminal ||
        (!buffer.dirty && buffer.lastSentAt !== null)
      ) {
        return;
      }
      try {
        const status = await deps.post(buildPayload(today, buffer));
        if (status >= 200 && status < 300) {
          updateDay(today, { ...buffer, dirty: false, lastSentAt: deps.now() });
          persist();
        }
      } catch {
        // Best-effort by contract: quit is never delayed past the POST timeout.
      }
    },

    dispose(): void {
      endTimer();
    },
  };
}
