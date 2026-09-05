/**
 * Types and constants for the usage analytics main-process service.
 *
 * The consent policy (on by default, `declined` never inferred away, an
 * unreadable file fails closed) is stated once, in
 * `src/telemetry/usage-notice.ts` and docs/internals/telemetry.md; this file
 * only encodes it. Main owns EVERYTHING here — consent, daily ids
 * and buffers live in `telemetry.json`, never in `settings.json` (settings
 * get copied to other machines and pasted into issues) and never in
 * `register-store.ts`'s allowlist (that would put the daily id one renderer
 * `invoke` away).
 */

/** Where every snapshot goes. Frozen into shipped binaries. */
export const TELEMETRY_ENDPOINT = "https://api.deck.spacevibe.dev/v1/ping";

/** The main-owned state file under userData. */
export const TELEMETRY_FILE = "telemetry.json";

/**
 * The consent version this build writes on every consent change, enabling or
 * declining alike. It no
 * longer gates anything: the downgrade-to-`unanswered` check went with the
 * consent question (2026-08-23), so a material payload, purpose, retention or
 * processor change is a DOCUMENT change — the privacy notice's own effective
 * date — not a state transition here.
 */
export const CONSENT_VERSION = 1;

export const SCHEMA_VERSION = 1;

/** A dirty buffer is sent no more than once every 15 minutes. */
export const SEND_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Heartbeat even when counters did not change. The VALUE matches the
 * renderer's `BACKGROUND_CHECK_INTERVAL_MS` (src/updater/update-controller.ts)
 * by the sending policy, duplicated here because main must own its own timer and an
 * `electron/` module must not import from `src/`.
 */
export const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const POST_TIMEOUT_MS = 5000;

/** At most seven days of pending buffers; the oldest drops first. */
export const MAX_PENDING_DAYS = 7;

/**
 * Upper bound on any single counter. Nothing legitimate approaches it; it
 * exists so a runaway renderer loop cannot grow a buffer past the server's
 * 4 KB body cap and turn the whole day terminal with a 413.
 */
export const COUNTER_CAP = 1_000_000;

/**
 * The closed agent key set, mirrored from `src/telemetry/payload.ts` the way
 * `electron/agents.ts` mirrors the agent catalog — main re-validates because
 * the renderer is not the trust boundary. The parity test in `service.test.ts`
 * pins the two lists together.
 */
export const AGENT_PAYLOAD_KEYS = [
  "claude",
  "codex",
  "opencode",
  "agy",
  "gemini",
  "cursor-agent",
  "custom",
] as const;

export const SURFACE_KEYS = ["browser", "explorer", "usage"] as const;

export type CountKind = "agent" | "surface" | "tabs" | "panes" | "restored";

export type ConsentAnswer = "unanswered" | "enabled" | "declined";

export type ConsentState = ConsentAnswer | "unreadable";

export interface TelemetryStateReply {
  readonly consent: ConsentState;
  readonly consentVersion: number;
}

/** One local day's cumulative buffer. Persisted inside `telemetry.json`. */
export interface DayBuffer {
  readonly dailyId: string;
  readonly agents: Readonly<Record<string, number>>;
  readonly surfaces: Readonly<Record<string, number>>;
  readonly maxTabs: number;
  readonly maxPanes: number;
  readonly restoredSessions: boolean;
  /** Counters changed since the last accepted send. */
  readonly dirty: boolean;
  /** Epoch ms of the last 204, or null before the first. */
  readonly lastSentAt: number | null;
  /** A 400/413 answer: never send this buffer again. */
  readonly terminal: boolean;
}

/** The whole persisted analytics state, under one key in `telemetry.json`. */
export interface PersistedTelemetry {
  readonly consent: ConsentAnswer;
  /** The version the user consented to; 0 before any decision. */
  readonly consentVersion: number;
  readonly days: Readonly<Record<string, DayBuffer>>;
}

/**
 * A fresh install counts and sends (owner-decided 2026-08-23, reversing the
 * spec's opt-in model).
 *
 * `unanswered` survives in the type because `TelemetryStateReply` still carries
 * it over IPC and a `telemetry.json` written by an opt-in build may still hold
 * it — `parsePersisted` folds that spelling into `enabled`. Nothing produces it
 * any more: there is no question to be unanswered.
 */
export const EMPTY_STATE: PersistedTelemetry = {
  consent: "enabled",
  consentVersion: CONSENT_VERSION,
  days: {},
};

/** What one POST carries — the whole cumulative snapshot for one day. */
export interface UsagePayloadLike {
  readonly schemaVersion: number;
  readonly dailyId: string;
  readonly day: string;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
  readonly agents: Readonly<Record<string, number>>;
  readonly surfaces: Readonly<Record<string, number>>;
  readonly maxTabs: number;
  readonly maxPanes: number;
  readonly restoredSessions: boolean;
}
