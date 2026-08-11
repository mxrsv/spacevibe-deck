/**
 * The tree rows, virtualized (plan T31).
 *
 * A 10k-entry directory is normal in the repos Deck is pointed at, and
 * rendering it as DOM is the difference between a panel and a freeze (spec
 * §3.1). Every row is exactly `ROW_HEIGHT` tall (DL-16.3), which is what makes
 * the windowing arithmetic exact rather than a measurement problem — the reason
 * a virtual-list dependency buys nothing here.
 */
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ChevronDown, ChevronRight } from "lucide-preact";
import { DeckIcon } from "../../ui/controls/deck-icon";
import type { TreeRow } from "../file-tree";
import { iconForRow } from "./file-icons";

/** DL-16.3: data rows in a docked panel are 22px. */
export const ROW_HEIGHT = 22;
/** DL-16.3: one fixed indent token per depth level. */
export const INDENT = 12;
/** Rows rendered beyond the viewport, so a fast scroll never shows a gap. */
const OVERSCAN = 6;

export interface FileTreeViewProps {
  readonly rows: readonly TreeRow[];
  readonly activePath: string | null;
  readonly scrollTop: number;
  readonly onScroll: (scrollTop: number) => void;
  /** Single click: expand a directory, preview a file. */
  readonly onActivate: (row: TreeRow) => void;
  /** Double click: promote a preview to a kept tab. */
  readonly onKeep: (row: TreeRow) => void;
}

/** The slice of rows a viewport of `height` px shows at `scrollTop`. */
export function visibleRange(
  total: number,
  scrollTop: number,
  height: number,
): { start: number; end: number } {
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const count = Math.ceil(height / ROW_HEIGHT);
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(total, first + count + OVERSCAN),
  };
}

export function FileTreeView(props: FileTreeViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // Height is measured, not assumed: the panel is a grid column whose height is
  // the window's, and a hard-coded guess would either render too few rows (a
  // visible gap) or all of them (the freeze this exists to avoid).
  const height = useSignal(600);
  const scrollTop = useSignal(props.scrollTop);
  const range = visibleRange(props.rows.length, scrollTop.value, height.value);
  const slice = props.rows.slice(range.start, range.end);

  return (
    <div
      class="explorer__tree"
      role="tree"
      aria-label="Workspace files"
      ref={(node: HTMLDivElement | null) => {
        viewportRef.current = node;
        if (node !== null) {
          height.value = node.clientHeight || height.value;
          // Restoring the workspace's scroll position is what makes switching
          // away and back feel like returning rather than reopening.
          if (node.scrollTop !== props.scrollTop) {
            node.scrollTop = props.scrollTop;
          }
        }
      }}
      onScroll={(event) => {
        const node = event.currentTarget;
        scrollTop.value = node.scrollTop;
        height.value = node.clientHeight;
        props.onScroll(node.scrollTop);
      }}
    >
      {/* One spacer of the full height, with the visible slice positioned
          inside it — so the scrollbar reflects the whole tree even though the
          DOM holds a screenful. */}
      <div
        class="explorer__spacer"
        style={{ height: `${props.rows.length * ROW_HEIGHT}px` }}
      >
        <div
          class="explorer__rows"
          style={{ transform: `translateY(${range.start * ROW_HEIGHT}px)` }}
        >
          {slice.map((row) => (
            <div
              key={row.path}
              role="treeitem"
              aria-selected={row.path === props.activePath}
              aria-expanded={row.directory ? row.expanded : undefined}
              tabIndex={0}
              data-path={row.path}
              class={`explorer__row ${row.path === props.activePath ? "is-active" : ""}`}
              style={{ paddingLeft: `${6 + row.depth * INDENT}px` }}
              onClick={() => props.onActivate(row)}
              onDblClick={() => props.onKeep(row)}
            >
              <span class="explorer__twisty">
                {row.directory && !row.outOfRoot && (
                  <DeckIcon
                    icon={row.expanded ? ChevronDown : ChevronRight}
                    size={13}
                  />
                )}
              </span>
              <span class="explorer__icon">
                <DeckIcon icon={iconForRow(row)} size={13} />
              </span>
              {/* DL-16.4: a data row keeps its content's real casing. */}
              <span class="explorer__name">{row.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
