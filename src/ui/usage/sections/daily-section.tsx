import { AGENT_LOGOS } from "../../../lib/agent-logos";
import { type DailyRow, dailyTotals } from "../../../lib/usage-aggregate";
import { totalTokens } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { MetricTable, type MetricColumn, type MetricRow } from "../metric-table";
import {
  EM_DASH,
  ESTIMATE_NOTE,
  formatTokens,
  formatTokensCompact,
  usdCell,
  USAGE_AGENT_LABEL,
} from "../usage-format";

/**
 * The daily view: one row per local calendar day, with the day's agents stacked
 * inside its `agent` cell (DL-15.9).
 *
 * It was a row per (day, agent) until 2026-08-15. A reader comparing days had
 * to add two rows together to get one day's number, and the agent column was a
 * word repeated down the table; the day is the unit this view is about, so the
 * day is now the row, and each agent keeps its own line — brand mark, name and
 * its own figures — inside it. The numeric columns state the day's totals.
 *
 * Local days, not UTC days — the boundary a user recognises is the one on
 * their own wall clock. Rust hands back 15-minute UTC buckets precisely so
 * this re-bucketing can happen here with the JS `Date`, DST included, without
 * a timezone crate in the binary (spec major M2).
 */

/** Spec §Surface: the daily view covers the last 30 local days. */
export const DAILY_DAYS = 30;

const COLUMNS: readonly MetricColumn[] = [
  { key: "day", label: "Day" },
  { key: "agent", label: "Agent" },
  { key: "tokens", label: "Tokens", numeric: true },
  { key: "usd", label: "Est. USD", numeric: true },
];

/**
 * One agent's line inside a day cell. The logo carries no alt text because the
 * agent's name is the very next element (DL-15.9) — an alt string here would
 * make every screen reader say the name twice.
 *
 * The figures are the compact form, not the grouped one: they sit inline beside
 * words rather than in a column of their own, which is the case
 * `formatTokensCompact` exists for. The day's grouped totals are still in the
 * numeric columns, where a column of digits IS compared down its length.
 */
function DayAgentLine({ row }: { readonly row: DailyRow }) {
  const logo = AGENT_LOGOS[row.agent];
  const usd = usdCell(row.costUsd);
  return (
    <li class="usage-day-agent">
      {logo === undefined ? (
        <span class="usage-day-agent__logo" />
      ) : (
        <img class="usage-day-agent__logo" src={logo} alt="" />
      )}
      <span class="usage-day-agent__label">{USAGE_AGENT_LABEL[row.agent]}</span>
      <span class="usage-day-agent__tokens">{formatTokensCompact(totalTokens(row.counters))}</span>
      <span class="usage-day-agent__usd">{usd ?? EM_DASH}</span>
    </li>
  );
}

export function DailySection() {
  const rows = dailyTotals(usageSnapshot.value?.buckets ?? [], DAILY_DAYS, Date.now());

  const unpriced = [...new Set(rows.flatMap((row) => row.unpricedModels))].sort();

  const note =
    unpriced.length === 0
      ? ESTIMATE_NOTE
      : `${ESTIMATE_NOTE} · no price for ${unpriced.join(", ")}`;

  const tableRows: readonly MetricRow[] = rows.map((row) => ({
    key: row.day,
    cells: [
      row.day,
      <ul class="usage-day-agents" key="agents">
        {row.agents.map((agent) => (
          <DayAgentLine key={agent.agent} row={agent} />
        ))}
      </ul>,
      formatTokens(totalTokens(row.counters)),
      usdCell(row.costUsd),
    ],
  }));

  return (
    <MetricTable
      title={`Last ${DAILY_DAYS} local days`}
      note={note}
      columns={COLUMNS}
      rows={tableRows}
      emptyLabel={`No data yet in the last ${DAILY_DAYS} local days`}
    />
  );
}
