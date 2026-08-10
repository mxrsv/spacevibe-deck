import { dailyRows } from "../../../lib/usage-aggregate";
import { totalTokens } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { MetricTable } from "../metric-table";
import type { MetricColumn, MetricRow } from "../metric-table";
import {
  ESTIMATE_NOTE,
  formatTokens,
  usdCell,
  USAGE_AGENT_LABEL,
} from "../usage-format";

/**
 * The daily view: one row per local calendar day and agent.
 *
 * Local days, not UTC days — the boundary a user recognises is the one on
 * their own wall clock. Rust hands back 15-minute UTC buckets precisely so
 * this re-bucketing can happen here with the JS `Date`, DST included, without
 * a timezone crate in the binary (spec major M2).
 */

/** Spec §Surface: the daily view covers the last 30 local days. */
export const DAILY_DAYS = 30;

const COLUMNS: readonly MetricColumn[] = [
  { key: "day", label: "day" },
  { key: "agent", label: "agent" },
  { key: "tokens", label: "tokens", numeric: true },
  { key: "usd", label: "est. usd", numeric: true },
];

export function DailySection() {
  const rows = dailyRows(
    usageSnapshot.value?.buckets ?? [],
    DAILY_DAYS,
    Date.now(),
  );

  const unpriced = [
    ...new Set(rows.flatMap((row) => row.unpricedModels)),
  ].sort();

  const note =
    unpriced.length === 0
      ? ESTIMATE_NOTE
      : `${ESTIMATE_NOTE} · no price for ${unpriced.join(", ")}`;

  const tableRows: readonly MetricRow[] = rows.map((row) => ({
    key: `${row.day}:${row.agent}`,
    cells: [
      row.day,
      USAGE_AGENT_LABEL[row.agent],
      formatTokens(totalTokens(row.counters)),
      usdCell(row.costUsd),
    ],
  }));

  return (
    <MetricTable
      title={`last ${DAILY_DAYS} local days`}
      note={note}
      columns={COLUMNS}
      rows={tableRows}
      emptyLabel={`no data yet in the last ${DAILY_DAYS} local days`}
    />
  );
}
