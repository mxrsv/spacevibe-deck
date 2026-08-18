import type { ComponentChild } from 'preact';
import { useId } from 'preact/hooks';
import { EM_DASH } from './usage-format';

/**
 * The read-only metric table (DL §15). One component owns the markup the way
 * `ConfigRow` owns §5, so the rules live in one file instead of being
 * re-derived per view: real `<table>` semantics (DL-15.7), a lowercase prose
 * header row (DL-15.5), numerals right-aligned with tabular figures
 * (DL-15.4), one em dash for anything unknown (DL-15.6), horizontal overflow
 * scrolling inside the table's own container (DL-15.3), and a header row that
 * survives an empty result (DL-15.8).
 *
 * Nothing in here is interactive, and that is a rule rather than an omission
 * (DL-15.2): no sort control, no row click handler, no row hover treatment.
 * A row that reacts to the pointer promises a click that does not exist.
 *
 * The accessible name comes from the visible `<h3>` above the table via
 * `aria-labelledby`, not from a `<caption>` — a caption is a child of the
 * table, so it would sit inside the scroll container and slide out of view
 * with the columns.
 */

export interface MetricColumn {
  /** Stable key for the column; also the render key of every cell in it. */
  readonly key: string;
  /** Lowercase header text (DL-15.5). */
  readonly label: string;
  /** Numeric columns are right-aligned with tabular figures (DL-15.4). */
  readonly numeric?: boolean;
}

export interface MetricRow {
  readonly key: string;
  /**
   * One entry per column, in column order. `null` — and a row shorter than
   * the column list — renders the em dash (DL-15.6). Values arrive
   * pre-formatted: the table decides alignment and absence, never units.
   *
   * A cell may be rendered content rather than a string (DL-15.9), which is
   * how the daily view stacks an agent's brand mark, name and figures inside
   * one cell. What it may NOT become is an interaction: DL-15.2 governs
   * whatever a section puts in here, so no cell carries a button, a link or a
   * hover treatment.
   */
  readonly cells: readonly ComponentChild[];
}

interface MetricTableProps {
  /** The visible heading that names the table (DL-15.7). */
  readonly title: string;
  /** Optional disclaimer under the table, wired up via `aria-describedby`. */
  readonly note?: string;
  readonly columns: readonly MetricColumn[];
  readonly rows: readonly MetricRow[];
  /** What the single spanning row says when there are no rows (DL-15.8). */
  readonly emptyLabel: string;
}

const cellClass = (column: MetricColumn): string =>
  column.numeric === true ? 'metric-table__cell metric-table__cell--num' : 'metric-table__cell';

export function MetricTable({ title, note, columns, rows, emptyLabel }: MetricTableProps) {
  // One id per instance; three tables can be on one screen over a session.
  const base = useId();
  const titleId = `metric-title-${base}`;
  const noteId = `metric-note-${base}`;

  return (
    <div class="metric-table">
      <h3 class="metric-table__title" id={titleId}>
        {title}
      </h3>
      <div class="metric-table__scroll">
        <table
          class="metric-table__table"
          aria-labelledby={titleId}
          aria-describedby={note === undefined ? undefined : noteId}
        >
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" class={cellClass(column)}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td class="metric-table__cell metric-table__empty" colSpan={columns.length}>
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  {columns.map((column, index) =>
                    index === 0 ? (
                      <th key={column.key} scope="row" class={cellClass(column)}>
                        {row.cells[index] ?? EM_DASH}
                      </th>
                    ) : (
                      <td key={column.key} class={cellClass(column)}>
                        {row.cells[index] ?? EM_DASH}
                      </td>
                    ),
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {note !== undefined && (
        <p class="metric-table__note" id={noteId}>
          {note}
        </p>
      )}
    </div>
  );
}
