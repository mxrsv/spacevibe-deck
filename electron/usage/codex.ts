/**
 * Codex rollout ingestion, and the dispatcher that routes one line to its
 * agent's parser. Port of `src-tauri/src/usage/codex.rs`.
 */
import { ingestClaudeLine, u64Field, type LineOutcome } from "./claude";
import { parseRfc3339Ms } from "./reader";
import {
  CODEX_EVENT_TYPE,
  CODEX_TOKEN_COUNT_TYPE,
  CODEX_TURN_CONTEXT_TYPE,
  EMPTY_CODEX_TOTALS,
  UNKNOWN_MODEL,
  addTotal,
  bucketStart,
  countersAreZero,
  sortTotals,
  type CodexTotals,
  type Contribution,
  type FileRecord,
  type UsageAgent,
  type UsageCounters,
} from "./model";

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Re-attribute a file's unattributed roll-ups to the first model it declares.
 *
 * A rollout's `token_count` events do not have to wait for its first
 * `turn_context`: real files emit them at lines 4-8 and only name a model
 * further down, so those deltas landed on `UNKNOWN_MODEL` — unpriced, which
 * blanked the Codex dollar column entirely. `turn_context` is written per
 * turn, so the first one names the model the session started with, which is
 * the right answer for everything ahead of it. Only the attribution moves:
 * each delta keeps its value and its bucket.
 */
export function backfillUnknownModel(record: FileRecord, model: string): void {
  if (!record.totals.some((entry) => entry.model === UNKNOWN_MODEL)) {
    return;
  }
  // A fresh vector rather than an in-place rewrite, and through `addTotal` so
  // a back-filled bucket merges with an existing one for the same model
  // instead of becoming a second entry.
  const taken = record.totals;
  const rebuilt: Contribution[] = [];
  for (const entry of taken) {
    const target = entry.model === UNKNOWN_MODEL ? model : entry.model;
    addTotal(rebuilt, entry.bucketStartMs, target, entry.counters);
  }
  sortTotals(rebuilt);
  record.totals = rebuilt;
}

/**
 * One line of a Codex rollout.
 *
 * `token_count` events carry **cumulative** totals for the whole session, so
 * each one contributes `max(0, cumulative - previous)` per counter,
 * attributed to the event's own timestamp and to the model from the most
 * recent `turn_context`. Last-snapshot ingestion is wrong here: real sessions
 * carry hundreds of snapshots, span multiple UTC days and switch models
 * mid-session.
 */
export function ingestCodexLine(bytes: Buffer, record: FileRecord): LineOutcome {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return "skipped";
  }
  const line = asObject(value);
  if (line === null) {
    return "skipped";
  }
  const kind = typeof line.type === "string" ? line.type : "";
  const payload = asObject(line.payload);
  if (payload === null) {
    return "ignored";
  }
  if (kind === CODEX_TURN_CONTEXT_TYPE) {
    const model = typeof payload.model === "string" ? payload.model : null;
    if (model !== null) {
      // Only the FIRST declaration back-fills. On a resumed scan `lastModel`
      // is already restored from the cache, so the window an earlier scan
      // resolved is never revisited and a mid-file model switch cannot drag
      // it along.
      if (record.lastModel === null) {
        backfillUnknownModel(record, model);
      }
      record.lastModel = model;
    }
    return "ignored";
  }
  if (
    kind !== CODEX_EVENT_TYPE ||
    (asObject(payload)?.type as unknown) !== CODEX_TOKEN_COUNT_TYPE
  ) {
    return "ignored";
  }
  // `payload.info.total_token_usage`, NOT `payload.total_token_usage`.
  // Reading the shallow path finds nothing and reports zero Codex usage
  // while looking perfectly healthy.
  const totals = asObject(asObject(payload.info)?.total_token_usage);
  if (totals === null) {
    return "skipped";
  }
  const timestamp = typeof line.timestamp === "string" ? line.timestamp : null;
  const parsedMs = timestamp === null ? null : parseRfc3339Ms(timestamp);
  if (parsedMs === null) {
    return "skipped";
  }
  const bucketStartMs = bucketStart(parsedMs);
  const seen: CodexTotals = {
    inputTokens: u64Field(totals, "input_tokens"),
    cachedInputTokens: u64Field(totals, "cached_input_tokens"),
    cacheWriteInputTokens: u64Field(totals, "cache_write_input_tokens"),
    outputTokens: u64Field(totals, "output_tokens"),
  };
  const previous = record.cumulative ?? EMPTY_CODEX_TOTALS;
  const delta: CodexTotals = {
    inputTokens: Math.max(0, seen.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, seen.cachedInputTokens - previous.cachedInputTokens),
    cacheWriteInputTokens: Math.max(0, seen.cacheWriteInputTokens - previous.cacheWriteInputTokens),
    outputTokens: Math.max(0, seen.outputTokens - previous.outputTokens),
  };
  // High-water mark, not last-seen. A resumed or forked session replays
  // inherited totals; storing the lower number would turn the later climb
  // back to the old high into tokens nobody spent.
  record.cumulative = {
    inputTokens: Math.max(previous.inputTokens, seen.inputTokens),
    cachedInputTokens: Math.max(previous.cachedInputTokens, seen.cachedInputTokens),
    cacheWriteInputTokens: Math.max(previous.cacheWriteInputTokens, seen.cacheWriteInputTokens),
    outputTokens: Math.max(previous.outputTokens, seen.outputTokens),
  };
  const counters: UsageCounters = {
    // `cached_input_tokens` is a SUBSET of `input_tokens`, so the uncached
    // part is the difference, never the whole input.
    inputUncached: Math.max(0, delta.inputTokens - delta.cachedInputTokens),
    cacheRead: delta.cachedInputTokens,
    // Codex has no 5m/1h tier split; its cache writes are one counter.
    cacheCreate5m: 0,
    cacheCreate1h: 0,
    cacheWrite: delta.cacheWriteInputTokens,
    // Already includes reasoning tokens; adding `reasoning_output_tokens`
    // would double-count them.
    output: delta.outputTokens,
  };
  if (countersAreZero(counters)) {
    // A non-advancing or regressing total contributes nothing.
    return "ignored";
  }
  const model = record.lastModel ?? UNKNOWN_MODEL;
  addTotal(record.totals, bucketStartMs, model, counters);
  return "counted";
}

/**
 * Route one line to its agent's parser.
 *
 * A blank line is ignored before either parser sees it: a trailing newline at
 * the end of every transcript must not inflate the "n lines skipped" note
 * the UI shows.
 */
export function ingest(agent: UsageAgent, bytes: Buffer, record: FileRecord): LineOutcome {
  // Exactly Rust's `u8::is_ascii_whitespace`: space, tab, LF, FF, CR — and
  // deliberately not vertical tab, so the two implementations agree on which
  // lines count as blank.
  if (
    bytes.every(
      (byte) => byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d,
    )
  ) {
    return "ignored";
  }
  return agent === "claude" ? ingestClaudeLine(bytes, record) : ingestCodexLine(bytes, record);
}
