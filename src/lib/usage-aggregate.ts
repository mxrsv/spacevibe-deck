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
  totalTokens,
  type UsageAgent,
  type UsageBucket,
  type UsageCounters,
} from "./usage-snapshot";

/**
 * §0.3 decision 8 ("null wins") refined on 2026-08-10, after it deleted a
 * correct figure on the real corpus. One model id — `unknown`, holding 0.2% of
 * Codex's tokens — nulled that agent, which nulled the grand total, which
 * blanked the whole screen: a rule meant to stop a MISLEADING number was
 * removing an ACCURATE one.
 *
 * The rule is now: report the priced part, disclose the gap, and never present
 * a partial sum as though it were complete. `costUsd` is the sum over the
 * models that HAVE a price and is null only when not one of them does;
 * `unpricedTokens` beside it is what makes the omission visible instead of
 * silent. Presenting the partial sum alone would be the failure this rule
 * originally guarded against — the disclosure is not decoration, it is the
 * other half of the rule.
 */
export interface AgentTotal {
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  /** Sum over priced models; null only when NO model here has a price. */
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
  /** Tokens belonging to `unpricedModels` — the part `costUsd` excludes. */
  readonly unpricedTokens: number;
}

export interface DailyRow {
  /** Local calendar day, "YYYY-MM-DD". */
  readonly day: string;
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  /** Sum over priced models; null only when NO model here has a price. */
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
  /** Tokens belonging to `unpricedModels` — the part `costUsd` excludes. */
  readonly unpricedTokens: number;
}

/**
 * One local day, with the agents that ran on it kept as their own entries.
 *
 * The daily table shows a day per row (2026-08-15), so the row carries both
 * levels: the per-agent figures the reader compares inside the day, and the
 * day's own totals in the numeric columns. The split is not cosmetic — costs
 * are rolled up per (day, agent) and then summed, never by flattening the two
 * agents' models into one map first, because two agents can report the same
 * model string (`unknown` does, on the real corpus) and flattening would fuse
 * two different agents' counters into a single priced entry.
 */
export interface DailyTotal {
  /** Local calendar day, "YYYY-MM-DD". */
  readonly day: string;
  /** Agents with data that day, in `dailyRows` order (agent ascending). */
  readonly agents: readonly DailyRow[];
  /** The day's counters, summed across its agents. */
  readonly counters: UsageCounters;
  /** Sum over the agents that have a price; null only when none does. */
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
  /** Tokens belonging to `unpricedModels` — the part `costUsd` excludes. */
  readonly unpricedTokens: number;
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
  readonly unpricedTokens: number;
}

/**
 * Sum the per-model costs of one group, keeping the priced and unpriced halves
 * apart (see the `AgentTotal` comment for why this changed on 2026-08-10).
 *
 * `costUsd` covers every model that has a price and goes null only when not
 * one of them does — one unrecognised id can no longer erase a figure the
 * other models fully support. `unpricedTokens` carries what was left out so
 * the caller can say so; a caller that renders the money and drops the
 * disclosure has reintroduced the original bug from the other side.
 *
 * A model contributing zero tokens is never "unpriced" — `estimateCostUsd`
 * answers 0 for it, which is arithmetic and not a price lookup, and it is what
 * keeps Claude's `<synthetic>` marker out of this list.
 */
function rollupCost(byModel: ReadonlyMap<string, UsageCounters>): CostRollup {
  const unpriced: string[] = [];
  let priced = 0;
  let pricedModels = 0;
  let unpricedTokens = 0;
  for (const [model, counters] of byModel) {
    const cost = estimateCostUsd(model, counters);
    if (cost === null) {
      unpriced.push(model);
      unpricedTokens += totalTokens(counters);
      continue;
    }
    priced += cost;
    pricedModels += 1;
  }
  return {
    costUsd: pricedModels === 0 ? null : priced,
    unpricedModels: [...new Set(unpriced)].sort(compareStrings),
    unpricedTokens,
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
 * One row per local day, each carrying its agents' rows and the day's own
 * totals. Same window, same ordering and same absence rule as `dailyRows`:
 * newest day first, days without usage absent rather than zero-filled.
 *
 * The money follows the 2026-08-10 rule one level up: the day's `costUsd` is
 * the sum over the agents that HAVE a price and is null only when not one of
 * them does, with `unpricedModels` beside it so the omission is stated rather
 * than silent. Summing already-rolled-up agent costs is what keeps a model
 * string shared by both agents from collapsing into one entry.
 */
export function dailyTotals(
  buckets: readonly UsageBucket[],
  days: number,
  nowMs: number,
): readonly DailyTotal[] {
  const byDay = new Map<string, readonly DailyRow[]>();
  for (const row of dailyRows(buckets, days, nowMs)) {
    byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  }
  // Insertion order is already newest day first: `dailyRows` sorted it.
  return [...byDay.entries()].map(([day, agents]) => {
    let counters = EMPTY_COUNTERS;
    let priced = 0;
    let costUsd = 0;
    let unpricedTokens = 0;
    const unpriced: string[] = [];
    for (const agent of agents) {
      counters = addCounters(counters, agent.counters);
      unpricedTokens += agent.unpricedTokens;
      unpriced.push(...agent.unpricedModels);
      if (agent.costUsd === null) {
        continue;
      }
      costUsd += agent.costUsd;
      priced += 1;
    }
    return {
      day,
      agents,
      counters,
      costUsd: priced === 0 ? null : costUsd,
      unpricedModels: [...new Set(unpriced)].sort(compareStrings),
      unpricedTokens,
    };
  });
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
