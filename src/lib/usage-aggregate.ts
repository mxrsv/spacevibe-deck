/**
 * Re-bucketing the Rust payload into the three views the usage screen shows.
 * Pure — no signals, no Tauri, no DOM.
 *
 * Rust hands back 15-minute UTC buckets and does no timezone work at all
 * (spec §Aggregate schema, major M2). Everything local happens here, using the
 * JS `Date`, which carries the host's zone rules and its DST history — which
 * is why the fifteen-minute grain matters: real offsets include :30 and :45
 * (India, Nepal, Chatham), and an hourly grain would put boundary-hour usage
 * on the wrong local day there.
 */

import { estimateCostUsd } from "./usage-pricing";
import {
  addCounters,
  EMPTY_COUNTERS,
  type UsageAgent,
  type UsageBucket,
  type UsageCounters,
} from "./usage-snapshot";

export interface AgentTotal {
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  /** null when ANY contributing model is unpriced (plan §0.3 decision 8). */
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}

export interface DailyRow {
  /** Local calendar day, "YYYY-MM-DD". */
  readonly day: string;
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}

export interface BreakdownRow {
  readonly agent: UsageAgent;
  /** The raw model string, verbatim. */
  readonly model: string;
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
}

/**
 * Joins a day key to an agent inside a Map key. A space cannot appear in either
 * half — the agent is a closed union and the day is digits and dashes — so
 * the split back apart is unambiguous.
 */
const KEY_SEPARATOR = " ";

/**
 * Local noon, not local midnight, as the anchor for day arithmetic. A DST
 * transition that lands on the anchor instant makes midnight either
 * non-existent or ambiguous; noon is never within a transition anywhere.
 */
const DAY_ANCHOR_HOUR = 12;

function pad2(value: number): string {
  return `${value}`.padStart(2, "0");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The host-local calendar day containing `utcMs`, as "YYYY-MM-DD". */
export function localDayKey(utcMs: number): string {
  const at = new Date(utcMs);
  return [
    `${at.getFullYear()}`.padStart(4, "0"),
    pad2(at.getMonth() + 1),
    pad2(at.getDate()),
  ].join("-");
}

/** The last `days` local calendar days ending on the day containing `nowMs`. */
function recentDayKeys(days: number, nowMs: number): readonly string[] {
  const now = new Date(nowMs);
  const keys: string[] = [];
  for (let back = 0; back < days; back += 1) {
    const anchor = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - back,
      DAY_ANCHOR_HOUR,
    );
    keys.push(localDayKey(anchor.getTime()));
  }
  return keys;
}

/**
 * Group buckets by a caller-chosen key, keeping the model dimension inside
 * each group. The model split has to survive grouping: a row's cost is the
 * sum of its models' costs, and merging counters across models first would
 * make that sum unrecoverable.
 */
function groupByModel<Key extends string>(
  buckets: readonly UsageBucket[],
  keyOf: (bucket: UsageBucket) => Key | null,
): ReadonlyMap<Key, ReadonlyMap<string, UsageCounters>> {
  const groups = new Map<Key, Map<string, UsageCounters>>();
  for (const bucket of buckets) {
    const key = keyOf(bucket);
    if (key === null) {
      continue;
    }
    const byModel = groups.get(key) ?? new Map<string, UsageCounters>();
    byModel.set(
      bucket.model,
      addCounters(byModel.get(bucket.model) ?? EMPTY_COUNTERS, bucket.counters),
    );
    groups.set(key, byModel);
  }
  return groups;
}

function sumCounters(
  byModel: ReadonlyMap<string, UsageCounters>,
): UsageCounters {
  let total = EMPTY_COUNTERS;
  for (const counters of byModel.values()) {
    total = addCounters(total, counters);
  }
  return total;
}

interface CostRollup {
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}

/**
 * Sum the per-model costs of one group. A single unpriced model makes the
 * whole figure `null`: a partial sum presented as a total is worse than no
 * number at all (plan §0.3 decision 8). A model contributing zero tokens is
 * never "unpriced" — `estimateCostUsd` answers 0 for it, which is arithmetic
 * and not a price lookup.
 */
function rollupCost(byModel: ReadonlyMap<string, UsageCounters>): CostRollup {
  const unpriced: string[] = [];
  let total = 0;
  for (const [model, counters] of byModel) {
    const cost = estimateCostUsd(model, counters);
    if (cost === null) {
      unpriced.push(model);
      continue;
    }
    total += cost;
  }
  const unpricedModels = [...new Set(unpriced)].sort(compareStrings);
  return {
    costUsd: unpricedModels.length > 0 ? null : total,
    unpricedModels,
  };
}

/**
 * Per-agent totals, optionally from `sinceMs` onwards. "Today" is the
 * caller's definition — it passes the local midnight that starts today, or
 * `null` for the whole recorded history.
 *
 * Only agents with data in range get a row. The screen renders both agent
 * slots from the snapshot's `sources`, which always carries exactly two.
 */
export function agentTotals(
  buckets: readonly UsageBucket[],
  sinceMs: number | null,
): readonly AgentTotal[] {
  const groups = groupByModel<UsageAgent>(buckets, (bucket) =>
    sinceMs !== null && bucket.bucketStartMs < sinceMs ? null : bucket.agent,
  );
  return [...groups.entries()]
    .map(([agent, byModel]) => ({
      agent,
      counters: sumCounters(byModel),
      ...rollupCost(byModel),
    }))
    .sort((left, right) => compareStrings(left.agent, right.agent));
}

/**
 * One row per (local day, agent) with data, across the last `days` local days
 * ending on the day containing `nowMs`. Newest day first, then agent. Days
 * with no usage are absent rather than zero-filled — the table shows what
 * happened, not a calendar.
 */
export function dailyRows(
  buckets: readonly UsageBucket[],
  days: number,
  nowMs: number,
): readonly DailyRow[] {
  if (days <= 0 || !Number.isFinite(nowMs)) {
    return [];
  }
  const window = new Set(recentDayKeys(days, nowMs));
  const groups = groupByModel<string>(buckets, (bucket) => {
    const day = localDayKey(bucket.bucketStartMs);
    return window.has(day) ? `${day}${KEY_SEPARATOR}${bucket.agent}` : null;
  });
  return [...groups.entries()]
    .map(([key, byModel]) => {
      const [day, agent] = key.split(KEY_SEPARATOR) as [string, UsageAgent];
      return {
        day,
        agent,
        counters: sumCounters(byModel),
        ...rollupCost(byModel),
      };
    })
    .sort(
      (left, right) =>
        compareStrings(right.day, left.day) ||
        compareStrings(left.agent, right.agent),
    );
}

/**
 * One row per (agent, raw model) over the whole recorded history. This is the
 * view where an unpriced model is diagnosable: the string is shown verbatim
 * and its own `costUsd` is `null`, so a missing snapshot entry names itself.
 */
export function breakdownRows(
  buckets: readonly UsageBucket[],
): readonly BreakdownRow[] {
  const groups = groupByModel<UsageAgent>(buckets, (bucket) => bucket.agent);
  const rows: BreakdownRow[] = [];
  for (const [agent, byModel] of groups) {
    for (const [model, counters] of byModel) {
      rows.push({
        agent,
        model,
        counters,
        costUsd: estimateCostUsd(model, counters),
      });
    }
  }
  return rows.sort(
    (left, right) =>
      compareStrings(left.agent, right.agent) ||
      compareStrings(left.model, right.model),
  );
}
