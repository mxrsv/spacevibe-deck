/**
 * Machine-wide token usage — shapes, frozen constants and the two counter
 * helpers. The Electron port of `src-tauri/src/usage/mod.rs`'s data half.
 *
 * **Privacy contract (ported verbatim).** The scanner necessarily reads file
 * bytes that include conversation content, but the parse loop keeps and
 * returns **only** usage counters, model strings, timestamps, session/message
 * ids and file paths. Conversation content never leaves this loop: it never
 * enters the cache, it never crosses the IPC boundary, and the one place a
 * raw byte range could have escaped — the session-identity fallback — hashes
 * the bytes instead of storing them.
 *
 * Field names are the camelCase serde output of the Rust structs, because
 * `src/lib/usage-snapshot.ts` is the single shared serialized contract and
 * the §6.1.7 parity gate deep-equals the two implementations' output.
 */

/**
 * Parser/schema version of the on-disk cache. A mismatch discards the cache
 * and forces a full rescan — bump it whenever a field's meaning changes, not
 * merely when one is added.
 *
 * **1001 (2026-08-14)** — the Electron cache versions independently from the
 * Rust one (cutover is a clean install; plan §6.1.4). Starting above 1000
 * keeps the two version spaces visibly disjoint: a Rust cache read by this
 * loader is discarded by number, never half-trusted by accident.
 */
export const USAGE_CACHE_VERSION = 1001;

/** Cache file name, inside Electron's app data beside the stores. */
export const USAGE_CACHE_FILE = "usage-cache.json";

/** Suffix of the same-directory temp file the cache is written through. */
export const CACHE_TEMP_SUFFIX = ".tmp";

/**
 * Fifteen-minute UTC buckets. Not hourly: real-world offsets include :30 and
 * :45 (India, Nepal, Chatham), where an hourly bucket puts boundary-hour
 * usage on the wrong local day once the frontend re-buckets into local days.
 */
export const BUCKET_MS = 15 * 60 * 1000;

/**
 * A file whose mtime is older than this loses its per-message contribution
 * map and keeps only its rolled-up counters. Age, not scan count: with a 5 s
 * poll a session merely paused for two minutes would compact and then force a
 * full re-read the moment the user typed again.
 */
export const COMPACT_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Separator inside the Claude dedupe key. U+0001 cannot occur in either id,
 * so `a<U+1>bc` and `ab<U+1>c` can never collide. Spelled as an escape so no
 * invisible byte hides in this source file.
 */
export const DEDUPE_SEPARATOR = "\u0001";

/**
 * Model string used when a transcript records usage without naming a model.
 * It stays raw and visible: the frontend prices only exact matches, so an
 * unpriced row shows tokens and a dash rather than a guessed dollar figure.
 */
export const UNKNOWN_MODEL = "unknown";

/**
 * Bytes read when resolving a file's session identity. Bounded because a
 * subagent transcript opens with a `type: "user"` line that can carry a
 * pasted blob — the same reason the line reader has a cap.
 */
export const IDENTITY_HEAD_BYTES = 64 * 1024;

export const CLAUDE_DIR = ".claude";
export const CLAUDE_PROJECTS_DIR = "projects";
export const CLAUDE_SUBAGENTS_DIR = "subagents";
export const CODEX_DIR = ".codex";
export const CODEX_SESSIONS_DIR = "sessions";
export const CODEX_ARCHIVED_DIR = "archived_sessions";
export const CODEX_ROLLOUT_PREFIX = "rollout-";
export const TRANSCRIPT_EXTENSION = ".jsonl";

/**
 * Directory depth the Codex walk will descend. `sessions/YYYY/MM/DD/file` is
 * three levels; six bounds a pathological tree without a symlink loop being
 * able to run the scan forever.
 */
export const MAX_WALK_DEPTH = 6;

export const CLAUDE_ASSISTANT_TYPE = "assistant";
export const CLAUDE_TIER_5M = "ephemeral_5m_input_tokens";
export const CLAUDE_TIER_1H = "ephemeral_1h_input_tokens";
export const CODEX_TURN_CONTEXT_TYPE = "turn_context";
export const CODEX_EVENT_TYPE = "event_msg";
export const CODEX_TOKEN_COUNT_TYPE = "token_count";

export type UsageAgent = "claude" | "codex";
export type UsageSourceState = "ok" | "missing" | "unreadable";

export interface UsageCounters {
  inputUncached: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cacheWrite: number;
  output: number;
}

export interface UsageSource {
  agent: UsageAgent;
  state: UsageSourceState;
  filesScanned: number;
}

export interface UsageBucket {
  bucketStartMs: number;
  agent: UsageAgent;
  /** The raw model string, verbatim — no canonicalization here. */
  model: string;
  counters: UsageCounters;
}

export interface UsageSnapshot {
  scannedAtMs: number;
  /** Sorted by (bucketStartMs, agent, model) so the payload is stable. */
  buckets: UsageBucket[];
  /** Exactly two entries, Claude then Codex. */
  sources: UsageSource[];
  skippedLines: number;
}

/**
 * One `{bucket, model}` worth of counters. Used twice: as a Claude message's
 * individual contribution (keyed by its dedupe key) and as an entry in a
 * file's rolled-up totals.
 */
export interface Contribution {
  bucketStartMs: number;
  model: string;
  counters: UsageCounters;
}

/**
 * The last cumulative totals seen in a Codex rollout, so delta ingestion
 * resumes from the stored numbers instead of re-deriving them from the top
 * of the file.
 */
export interface CodexTotals {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
}

/** Everything the cache remembers about one transcript file. */
export interface FileRecord {
  agent: UsageAgent;
  /**
   * Session identity read from the first line. A file whose identity changed
   * is a different session at the same path, so it is rescanned from zero
   * even when its size did not move.
   */
  identity: string;
  mtimeMs: number;
  size: number;
  /** Byte offset just past the last complete line ingested. */
  offset: number;
  /** Cumulative for this file across scans. */
  skippedLines: number;
  /** Set once the file aged past `COMPACT_AFTER_MS`. */
  compacted: boolean;
  /**
   * Claude only, and only while uncompacted: dedupe key → contribution.
   * Last-wins survives an offset resume because a re-seen key REPLACES its
   * previous contribution instead of adding a second one.
   */
  entries: Map<string, Contribution>;
  /**
   * Codex's accumulated per-`{bucket, model}` deltas, and where a compacted
   * file's roll-up lives for either agent.
   */
  totals: Contribution[];
  /** Codex only: the model from the most recent `turn_context` line. */
  lastModel: string | null;
  /** Codex only: the high-water cumulative totals seen so far. */
  cumulative: CodexTotals | null;
}

/** The whole cache. The map is kept path-sorted so merges are deterministic. */
export interface UsageCache {
  cacheVersion: number;
  files: Map<string, FileRecord>;
}

export const EMPTY_COUNTERS: UsageCounters = Object.freeze({
  inputUncached: 0,
  cacheRead: 0,
  cacheCreate5m: 0,
  cacheCreate1h: 0,
  cacheWrite: 0,
  output: 0,
});

export const EMPTY_CODEX_TOTALS: CodexTotals = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
});

export function emptyRecord(
  agent: UsageAgent,
  identity: string,
  mtimeMs: number,
  size: number,
): FileRecord {
  return {
    agent,
    identity,
    mtimeMs,
    size,
    offset: 0,
    skippedLines: 0,
    compacted: false,
    entries: new Map(),
    totals: [],
    lastModel: null,
    cumulative: null,
  };
}

export function emptyCache(): UsageCache {
  return { cacheVersion: USAGE_CACHE_VERSION, files: new Map() };
}

export function bucketStart(unixMs: number): number {
  return unixMs - (unixMs % BUCKET_MS);
}

export function addCounters(
  left: UsageCounters,
  right: UsageCounters,
): UsageCounters {
  return {
    inputUncached: left.inputUncached + right.inputUncached,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheCreate5m: left.cacheCreate5m + right.cacheCreate5m,
    cacheCreate1h: left.cacheCreate1h + right.cacheCreate1h,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    output: left.output + right.output,
  };
}

export function countersAreZero(counters: UsageCounters): boolean {
  return (
    counters.inputUncached === 0 &&
    counters.cacheRead === 0 &&
    counters.cacheCreate5m === 0 &&
    counters.cacheCreate1h === 0 &&
    counters.cacheWrite === 0 &&
    counters.output === 0
  );
}

/**
 * Add `counters` into the `{bucket, model}` slot, creating it if new. A
 * linear scan on purpose: one file holds a handful of buckets per hour of
 * work.
 */
export function addTotal(
  totals: Contribution[],
  bucketStartMs: number,
  model: string,
  counters: UsageCounters,
): void {
  const slot = totals.find(
    (entry) => entry.bucketStartMs === bucketStartMs && entry.model === model,
  );
  if (slot !== undefined) {
    slot.counters = addCounters(slot.counters, counters);
    return;
  }
  totals.push({ bucketStartMs, model, counters });
}

/**
 * Deterministic order, so the serialized cache does not churn between scans
 * that produced identical numbers.
 */
export function sortTotals(totals: Contribution[]): void {
  totals.sort((left, right) =>
    left.bucketStartMs !== right.bucketStartMs
      ? left.bucketStartMs - right.bucketStartMs
      : left.model < right.model
        ? -1
        : left.model > right.model
          ? 1
          : 0,
  );
}
