import { useRef, useState } from "preact/hooks";
import type { BoardProjectRow, BoardStatusFilter, BoardStatusRow } from "./agent-board-model";

/** STATUS then PROJECTS (spec §6, DL-34.8): two listboxes, totals not filtered. */
export interface AgentBoardNavProps {
  readonly status: readonly BoardStatusRow[];
  readonly projects: readonly BoardProjectRow[];
  readonly onStatusFilter: (filter: BoardStatusFilter) => void;
  readonly onProjectFilter: (key: string | null) => void;
}

/** One row, flattened out of whichever model row produced it. */
interface NavRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly title?: string;
  readonly pick: () => void;
}

interface NavGroupProps {
  readonly headingId: string;
  readonly heading: string;
  readonly rows: readonly NavRow[];
}

/**
 * One listbox with roving focus (spec §6, "the nav is a listbox"). The gate-1
 * eye pass found the group CLAIMING `listbox`/`option` while behaving as a
 * button row — arrow keys did nothing and nine rows spent nine Tab stops — so
 * screen-reader users were told to reach for keys that were not implemented.
 * Exactly one row is tabbable at a time; ↑/↓/Home/End move focus inside the
 * group, Tab leaves it. Enter and Space are the button's own press, so the
 * listbox needs no key handling of its own for activation. Escape is
 * deliberately NOT handled: it belongs to the Board (DL-34.9) and must reach
 * the root's handler.
 */
function NavGroup({ headingId, heading, rows }: NavGroupProps) {
  const list = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // Focus starts on the selected row — the one the user is looking at — and
  // follows whatever they last focused. A key that has left the model (a
  // project whose last card closed) falls back the same way.
  const known = rows.findIndex((row) => row.key === focusedKey);
  const focusIndex =
    known >= 0
      ? known
      : Math.max(
          0,
          rows.findIndex((row) => row.active),
        );

  const focusRow = (index: number): void => {
    const options = list.current?.querySelectorAll<HTMLButtonElement>("[role='option']");
    if (options === undefined || options.length === 0) return;
    options[Math.min(Math.max(index, 0), options.length - 1)].focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const moves: Record<string, number> = {
      ArrowDown: focusIndex + 1,
      ArrowUp: focusIndex - 1,
      Home: 0,
      End: rows.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusRow(next);
  };

  return (
    <div class="board-nav__group">
      <span class="board-label" id={headingId}>
        {heading}
      </span>
      <div role="listbox" aria-labelledby={headingId} ref={list} onKeyDown={onKeyDown}>
        {rows.map((row, index) => (
          <button
            key={row.key}
            type="button"
            role="option"
            class="board-nav__row"
            aria-selected={row.active}
            // Spelled out rather than left to the row's own text: below the
            // fold width the label is hidden and the content would announce
            // as a bare number (spec §5.7).
            aria-label={`${row.label} ${row.count}`}
            title={row.title}
            tabIndex={index === focusIndex ? 0 : -1}
            onFocus={() => setFocusedKey(row.key)}
            onClick={row.pick}
          >
            <span class="board-nav__label">{row.label}</span>
            <span class="board-nav__count">{row.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentBoardNav({
  status,
  projects,
  onStatusFilter,
  onProjectFilter,
}: AgentBoardNavProps) {
  return (
    <nav class="agent-board__nav" aria-label="Agent Board filters">
      <NavGroup
        headingId="board-nav-status"
        heading="Status"
        rows={status.map((row) => ({
          key: row.filter,
          label: row.label,
          count: row.count,
          active: row.active,
          pick: () => onStatusFilter(row.filter),
        }))}
      />
      {projects.length > 0 && (
        <NavGroup
          headingId="board-nav-projects"
          heading="Projects"
          rows={projects.map((row) => ({
            key: row.key,
            label: row.label,
            count: row.count,
            active: row.active,
            title: row.label,
            pick: () => onProjectFilter(row.active ? null : row.key),
          }))}
        />
      )}
    </nav>
  );
}
