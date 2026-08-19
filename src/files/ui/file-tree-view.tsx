/**
 * The tree body of the explorer panel (plan Task 2, spec §3.1).
 *
 * Rows are windowed by plain index arithmetic over `scrollTop` and the
 * container's measured height — fixed 22px rows (DL-19), no virtualization
 * dependency (plan T4, spec §9's dependency table names a virtual list, but
 * a fixed row height makes the index math cheaper than depending on one).
 * Below the measured-viewport threshold (tests, and the instant before the
 * first layout) every row renders, so a small tree never has to wait on a
 * `ResizeObserver` tick to show its rows.
 *
 * Icons come from `file-icons.ts` (DL §19's file-type icon rule); keyboard
 * focus is a roving tabindex — one row is a tab stop at a time, arrows move
 * it and expand/collapse (spec §3.1), matching the pattern `settings-nav.tsx`
 * already uses for a vertical list.
 */
import type { ComponentChild } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { canExpand, type TreeRow } from "../file-tree";
import { listingErrorsFor, surfaceFor, treeRows } from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import { chevronForRow, iconForRow } from "./file-icons";
import { LoadError } from "../../ui/controls/load-error";

export interface FileTreeViewProps {
  readonly controller: FileSurfaceController;
  readonly workspacePath: string;
}

/** DL-19: data rows are 22px. The windowing math is built on this constant,
 * not read from layout, so it stays correct even for an offscreen row. */
const ROW_HEIGHT = 22;

/** Rows kept mounted just past the viewport edge, so a fast arrow-key or
 * wheel scroll never shows a blank frame while the next row mounts. */
const OVERSCAN = 8;

export function FileTreeView(props: FileTreeViewProps) {
  const { controller, workspacePath } = props;
  const rows = treeRows(workspacePath);
  const loaded = surfaceFor(workspacePath).listings.has(workspacePath);
  const listingErrors = listingErrorsFor(workspacePath);

  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingFocusRef = useRef<number | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);

  // The root listing is not loaded by anything else — without this the tree
  // stays empty forever the first time a workspace is shown.
  useEffect(() => {
    void controller.ensureListing(workspacePath, workspacePath);
  }, [controller, workspacePath]);

  // Measure the scroll container once mounted, and again whenever the panel
  // resizes. `ResizeObserver` is absent in the test environment, and that is
  // fine: `measured` below falls back to rendering every row rather than
  // guessing a viewport height.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (node === null) {
      return;
    }
    const measure = (): void => setViewportHeight(node.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A collapse (or a filtered listing) can shrink the row count below the
  // focused index. Growing the list never moves focus.
  useEffect(() => {
    setFocusedIndex((current) => Math.min(current, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  // Runs after every render; a no-op unless a keyboard move left a pending
  // target. Scrolling the target into view happens first (which re-renders,
  // so this effect runs again); the row is then focused once its own row
  // element exists in `rowRefs`.
  /* oxlint-disable react-hooks/exhaustive-deps -- runs after every render by design; the setState is guarded */
  useEffect(() => {
    const node = containerRef.current;
    const index = pendingFocusRef.current;
    if (node === null || index === null) {
      return;
    }
    if (viewportHeight > 0) {
      const rowTop = index * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < node.scrollTop) {
        node.scrollTop = rowTop;
        setScrollTop(rowTop);
        return;
      }
      if (rowBottom > node.scrollTop + viewportHeight) {
        const next = rowBottom - viewportHeight;
        node.scrollTop = next;
        setScrollTop(next);
        return;
      }
    }
    const el = rowRefs.current.get(index);
    if (el !== undefined) {
      el.focus();
    }
    pendingFocusRef.current = null;
  });
  /* oxlint-enable react-hooks/exhaustive-deps */

  function activateRow(row: TreeRow): void {
    if (row.directory) {
      // A symlink out of the root renders as a leaf and does not open
      // (spec §3.1) — canExpand is false for it, so this is a no-op.
      if (canExpand(row)) {
        controller.toggleDirectory(workspacePath, row.path);
      }
      return;
    }
    // Single click/Enter opens the workspace's preview tab (spec §4.1); a
    // double-click below promotes it to a kept tab.
    void controller.openFile(workspacePath, row.path, false);
  }

  function handleRowClick(row: TreeRow, index: number, target: HTMLDivElement): void {
    setFocusedIndex(index);
    target.focus();
    activateRow(row);
  }

  function handleDoubleClick(row: TreeRow): void {
    if (!row.directory) {
      void controller.openFile(workspacePath, row.path, true);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (rows.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(rows.length - 1, focusedIndex + 1);
      pendingFocusRef.current = next;
      setFocusedIndex(next);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, focusedIndex - 1);
      pendingFocusRef.current = next;
      setFocusedIndex(next);
      return;
    }
    const row = rows[focusedIndex];
    if (row === undefined) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.directory && canExpand(row) && !row.expanded) {
        controller.toggleDirectory(workspacePath, row.path);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.directory && row.expanded) {
        controller.toggleDirectory(workspacePath, row.path);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activateRow(row);
    }
  }

  function handleScroll(event: Event): void {
    setScrollTop((event.currentTarget as HTMLDivElement).scrollTop);
  }

  // Unmeasured (no layout yet, or the test environment's `ResizeObserver`
  // gap) renders every row rather than guessing — the only case that costs
  // anything is a directory large enough that windowing matters, and a real
  // window always reports a real height before that directory is visible.
  const measured = viewportHeight > 0;
  const startIndex = measured ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const endIndex = measured
    ? Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
    : rows.length;
  const visible = rows.slice(startIndex, endIndex);

  let body: ComponentChild;
  if (!loaded && listingErrors.has(workspacePath)) {
    body = null;
  } else if (!loaded) {
    body = <p class="file-tree__status">Loading…</p>;
  } else if (rows.length === 0) {
    body = <p class="file-tree__status">No files</p>;
  } else {
    body = (
      <div class="file-tree__rows" style={{ height: `${rows.length * ROW_HEIGHT}px` }}>
        {visible.map((row, offset) => {
          const index = startIndex + offset;
          return (
            <div
              key={row.path}
              ref={(el) => {
                if (el === null) {
                  rowRefs.current.delete(index);
                } else {
                  rowRefs.current.set(index, el);
                }
              }}
              role="treeitem"
              aria-expanded={row.directory ? row.expanded : undefined}
              aria-level={row.depth + 1}
              tabIndex={index === focusedIndex ? 0 : -1}
              // DL-19: data rows are 22px, one fixed indent token per depth.
              class="file-tree__row"
              style={{
                top: `${index * ROW_HEIGHT}px`,
                paddingLeft: `${8 + row.depth * 14}px`,
              }}
              onClick={(event) => handleRowClick(row, index, event.currentTarget as HTMLDivElement)}
              onDblClick={() => handleDoubleClick(row)}
            >
              <span
                class="file-tree__chevron"
                style={{ visibility: row.directory ? "visible" : "hidden" }}
              >
                <DeckIcon icon={chevronForRow(row)} size={ROW_ICON} />
              </span>
              <span class="file-tree__icon">
                <DeckIcon icon={iconForRow(row)} size={ROW_ICON} />
              </span>
              {/* DL-19: a data row keeps its content's real casing. */}
              <span class="file-tree__name">{row.name}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div class="file-tree-shell">
      {listingErrors.size > 0 ? (
        <LoadError
          message={listingErrors.values().next().value ?? "Couldn't read this folder."}
          onRetry={() => {
            for (const directory of listingErrors.keys()) {
              void controller.ensureListing(workspacePath, directory);
            }
          }}
        />
      ) : null}
      <div
        ref={containerRef}
        class="file-tree"
        role="tree"
        aria-label="File explorer"
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        {body}
      </div>
    </div>
  );
}
