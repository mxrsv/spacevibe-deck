/**
 * The periods the usage overview's display figure can cover (DL-16.7). Pure —
 * no signals, no Tauri, no DOM.
 *
 * Boundaries are **local calendar days, never rolling 24-hour windows**. The
 * daily view sits one rail item away and is bucketed by local day; a "7 days"
 * that cut off mid-afternoon would put a different number beside the same
 * label on two screens of the same app, and the reader would have no way to
 * tell which one was lying.
 */

export type UsageRangeId = 'today' | '7d' | '30d' | 'all';

export interface UsageRange {
  readonly id: UsageRangeId;
  /** Lowercase display label (DL-16.7, DL-4.3) — distinct from `id`. */
  readonly label: string;
  /** Local days covered, counting today. `null` is the whole history. */
  readonly days: number | null;
  /**
   * What to say when this period holds nothing. Per-range rather than one
   * shared string: DL-16.7 requires an empty period to name WHICH period is
   * empty, so "nothing here" is not an acceptable answer for any of them.
   */
  readonly emptyLabel: string;
}

/** Display order, shortest period first (DL-16.7: all of them visible at once). */
export const USAGE_RANGES: readonly UsageRange[] = [
  { id: 'today', label: 'Today', days: 1, emptyLabel: 'No usage today' },
  {
    id: '7d',
    label: '7 days',
    days: 7,
    emptyLabel: 'No usage in the last 7 local days',
  },
  {
    id: '30d',
    label: '30 days',
    days: 30,
    emptyLabel: 'No usage in the last 30 local days',
  },
  { id: 'all', label: 'All', days: null, emptyLabel: 'No data yet' },
];

/** The range shown until the reader picks one: the whole recorded history. */
export const DEFAULT_USAGE_RANGE: UsageRangeId = 'all';

/**
 * Local midnight for `nowMs`. `new Date(y, m, d)` is DST-correct by
 * construction — on a spring-forward day it still resolves to the first
 * instant of the local day rather than to a clock time that never happened.
 *
 * The comparison it feeds (`bucketStartMs >= since`) is exact rather than
 * approximate: every real-world UTC offset is a whole number of 15-minute
 * steps, including the :30 and :45 offsets, so local midnight always lands on
 * a bucket boundary. That is the reason `BUCKET_MS` is 15 minutes.
 */
export function startOfLocalDay(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * The instant a range starts, ready for `agentTotals(buckets, sinceMs)`, or
 * `null` for the whole recorded history.
 *
 * The day count goes through the `Date` constructor rather than subtracting
 * `n * 86_400_000`: the constructor normalises across month and year ends and
 * re-resolves the local offset, so a range spanning a DST change still starts
 * at midnight instead of at 23:00 the evening before.
 */
export function rangeSinceMs(range: UsageRange, nowMs: number): number | null {
  if (range.days === null) {
    return null;
  }
  const now = new Date(nowMs);
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    // `days` counts today, so a 7-day range reaches back six days.
    now.getDate() - (range.days - 1),
  ).getTime();
}
