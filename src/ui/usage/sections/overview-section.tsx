import type { AgentTotal } from "../../../lib/usage-aggregate";
import { agentTotals } from "../../../lib/usage-aggregate";
import type { UsageAgent } from "../../../lib/usage-snapshot";
import { totalTokens } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { MetricTable } from "../metric-table";
import type { MetricColumn, MetricRow } from "../metric-table";
import {
  ESTIMATE_NOTE,
  formatTokens,
  usdCell,
  USAGE_AGENT_LABEL,
  USAGE_AGENT_ORDER,
} from "../usage-format";

/**
 * The overview: what each agent has cost today, beside what it has cost over
 * the history that still exists on disk.
 *
 * "Recorded history" rather than "all-time" is not a stylistic choice — the
 * CLIs prune their own transcripts, so the older column is a floor, not a
 * total, and the copy must not promise otherwise (spec §Goal).
 */

/**
 * Local midnight for `nowMs`. `new Date(y, m, d)` is DST-correct by
 * construction — on a spring-forward day it still resolves to the first
 * instant of the local day rather than to a clock time that never happened.
 *
 * The comparison it feeds (`bucketStartMs >= startOfLocalDay(now)`) is exact
 * rather than approximate: every real-world UTC offset is a whole number of
 * 15-minute steps, including the :30 and :45 offsets, so local midnight always
 * lands on a bucket boundary. That is the reason `BUCKET_MS` is 15 minutes.
 *
 * It lives here rather than in `src/lib/` because this section owns no path
 * under `src/lib/`; it is exported so its own test can exercise it directly.
 */
export function startOfLocalDay(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const COLUMNS: readonly MetricColumn[] = [
  { key: "agent", label: "agent" },
  { key: "today-tokens", label: "tokens today", numeric: true },
  { key: "today-usd", label: "est. usd today", numeric: true },
  { key: "recorded-tokens", label: "tokens recorded", numeric: true },
  { key: "recorded-usd", label: "est. usd recorded", numeric: true },
];

const byAgent = (
  totals: readonly AgentTotal[],
): ReadonlyMap<UsageAgent, AgentTotal> =>
  new Map(totals.map((total) => [total.agent, total]));

/**
 * A dash, not a zero, when the agent contributed no bucket at all: we did not
 * measure zero tokens, we measured nothing (DL-15.6).
 */
const tokensCell = (total: AgentTotal | undefined): string | null =>
  total === undefined ? null : formatTokens(totalTokens(total.counters));

export function OverviewSection() {
  const buckets = usageSnapshot.value?.buckets ?? [];
  const today = byAgent(agentTotals(buckets, startOfLocalDay(Date.now())));
  const recorded = byAgent(agentTotals(buckets, null));

  // Every known agent gets a row even with nothing in it — a row that
  // disappears reads as "this agent is not supported" rather than "unused".
  const rows: readonly MetricRow[] = USAGE_AGENT_ORDER.map((agent) => ({
    key: agent,
    cells: [
      USAGE_AGENT_LABEL[agent],
      tokensCell(today.get(agent)),
      usdCell(today.get(agent)?.costUsd ?? null),
      tokensCell(recorded.get(agent)),
      usdCell(recorded.get(agent)?.costUsd ?? null),
    ],
  }));

  // A null total says "we could not price all of this"; naming the models is
  // what makes that diagnosable instead of mysterious (§0.3 decision 8).
  const unpriced = [
    ...new Set(
      [...today.values(), ...recorded.values()].flatMap(
        (total) => total.unpricedModels,
      ),
    ),
  ].sort();

  const note =
    unpriced.length === 0
      ? ESTIMATE_NOTE
      : `${ESTIMATE_NOTE} · no price for ${unpriced.join(", ")}`;

  return (
    <MetricTable
      title="per-agent totals"
      note={note}
      columns={COLUMNS}
      rows={rows}
      emptyLabel="no data yet"
    />
  );
}
