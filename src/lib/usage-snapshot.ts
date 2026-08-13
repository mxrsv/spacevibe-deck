/**
 * The `usage_snapshot` payload mirrored in TypeScript, plus the two counter
 * operations every rollup needs. Pure — no signals, no Tauri, no DOM.
 *
 * The field names here are the camelCase serde output of the Rust structs in
 * `src-tauri/src/usage.rs`. Nothing in TypeScript can catch a rename on the
 * Rust side; the serialization-contract test in that module is what does.
 *
 * The six counters never overlap, so summing them is a real token total. That
 * is a property of the Rust mapping and not a coincidence: Codex reports
 * `cached_input_tokens` as a SUBSET of `input_tokens`, and `usage.rs` stores
 * `input_uncached = input - cached` precisely so nothing is counted twice.
 */

export type UsageAgent = "claude" | "codex";
export type UsageSourceState = "ok" | "missing" | "unreadable";

export interface UsageCounters {
  readonly inputUncached: number;
  readonly cacheRead: number;
  readonly cacheCreate5m: number;
  readonly cacheCreate1h: number;
  readonly cacheWrite: number;
  readonly output: number;
}

export interface UsageSource {
  readonly agent: UsageAgent;
  readonly state: UsageSourceState;
  readonly filesScanned: number;
}

export interface UsageBucket {
  /** Unix ms at the start of the 15-minute UTC bucket. */
  readonly bucketStartMs: number;
  readonly agent: UsageAgent;
  /** The raw model string, verbatim — no canonicalization in Rust. */
  readonly model: string;
  readonly counters: UsageCounters;
}

/** Mirror of the Rust `UsageSnapshot` payload from the `usage_snapshot` command. */
export interface UsageSnapshot {
  /** Unix ms when the scan finished. */
  readonly scannedAtMs: number;
  /** Sorted by (bucketStartMs, agent, model) so the payload is stable. */
  readonly buckets: readonly UsageBucket[];
  /** Exactly two entries, Claude then Codex. */
  readonly sources: readonly UsageSource[];
  readonly skippedLines: number;
}

export const EMPTY_COUNTERS: UsageCounters = {
  inputUncached: 0,
  cacheRead: 0,
  cacheCreate5m: 0,
  cacheCreate1h: 0,
  cacheWrite: 0,
  output: 0,
};

/**
 * The "nothing found" snapshot, used as the default for the in-memory client.
 *
 * `sources` carries both agents in the `missing` state rather than an empty
 * array: the payload's "exactly two entries" invariant is what lets the screen
 * render an agent slot without a presence check, and a constant that quietly
 * breaks it would only fail in the one code path nobody exercises.
 */
export const EMPTY_USAGE_SNAPSHOT: UsageSnapshot = {
  scannedAtMs: 0,
  buckets: [],
  sources: [
    { agent: "claude", state: "missing", filesScanned: 0 },
    { agent: "codex", state: "missing", filesScanned: 0 },
  ],
  skippedLines: 0,
};

/** Field-wise sum. Returns a new object; neither argument is touched (C1). */
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

/** Every token in the bucket. Safe to add up — see the module comment. */
export function totalTokens(counters: UsageCounters): number {
  return (
    counters.inputUncached +
    counters.cacheRead +
    counters.cacheCreate5m +
    counters.cacheCreate1h +
    counters.cacheWrite +
    counters.output
  );
}
