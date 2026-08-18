import { breakdownRows } from '../../../lib/usage-aggregate';
import { usageSnapshot } from '../../../usage/usage-store';
import { MetricTable } from '../metric-table';
import type { MetricColumn, MetricRow } from '../metric-table';
import { ESTIMATE_NOTE, formatTokens, usdCell, USAGE_AGENT_LABEL } from '../usage-format';

/**
 * The breakdown: one row per agent and raw model, with all six counter
 * classes kept apart.
 *
 * The title says "per agent and model" rather than the multiplication-sign
 * notation the plan drafted. That character is a RETIRED glyph in this repo —
 * it meant remove/close before the unified icon migration — and
 * `scripts/icon-system.test.ts` fails any source file that contains one,
 * comments included. Naming the two keys in words costs nothing and keeps
 * that guard intact.
 *
 * They are never merged into one "input" column (blocker B4, §0.3 decision 7):
 * each class prices differently, and Codex's cached input is a *subset* of its
 * input rather than a sibling of it, so a summed column would be wrong in two
 * different ways at once.
 *
 * The model string is printed exactly as the transcript wrote it. v1 matches
 * prices by exact model id only, so a missing price shows as a dash beside a
 * name the user can look up — the alternative, a guessed alias, produces a
 * confident number that is quietly wrong.
 */

const COLUMNS: readonly MetricColumn[] = [
  { key: 'agent', label: 'Agent' },
  { key: 'model', label: 'Model' },
  { key: 'input-uncached', label: 'Input uncached', numeric: true },
  { key: 'cache-read', label: 'Cache read', numeric: true },
  { key: 'cache-create-5m', label: 'Cache create 5m', numeric: true },
  { key: 'cache-create-1h', label: 'Cache create 1h', numeric: true },
  { key: 'cache-write', label: 'Cache write', numeric: true },
  { key: 'output', label: 'Output', numeric: true },
  { key: 'usd', label: 'Est. USD', numeric: true },
];

export function BreakdownSection() {
  const rows: readonly MetricRow[] = breakdownRows(usageSnapshot.value?.buckets ?? []).map(
    (row) => ({
      key: `${row.agent}:${row.model}`,
      cells: [
        USAGE_AGENT_LABEL[row.agent],
        row.model,
        formatTokens(row.counters.inputUncached),
        formatTokens(row.counters.cacheRead),
        formatTokens(row.counters.cacheCreate5m),
        formatTokens(row.counters.cacheCreate1h),
        formatTokens(row.counters.cacheWrite),
        formatTokens(row.counters.output),
        usdCell(row.costUsd),
      ],
    }),
  );

  return (
    <MetricTable
      title="Per agent and model"
      note={ESTIMATE_NOTE}
      columns={COLUMNS}
      rows={rows}
      emptyLabel="No data yet"
    />
  );
}
