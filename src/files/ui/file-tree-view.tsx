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
import {
  clearTreeFocus,
  listingErrorsFor,
  pendingTreeFocus,
  surfaceFor,
  treeRows,
} from "../file-surface-store";
import { resolveFocusIndex } from "../tree-focus";
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
  const surface = surfaceFor(workspacePath);
  const rows = treeRows(workspacePath);
  const loaded = surface.listings.has(workspacePath);
  const listingErrors = listingErrorsFor(workspacePath);

  const containerRef = useRef<HTMLDivElement>(null);
  // Keyed by PATH, not by index: rows re-sort under a create or a
  // `showHidden` flip, and an index-keyed map hands the focus effect a
  // stale element (design §3.4).
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusRef = useRef<string | null>(null);
  /** The index the focused path last occupied, so a path that leaves the tree
   * falls back to where it was rather than to the top. */
  const lastIndexRef = useRef(0);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const focusedIndex = resolveFocusIndex(rows, focusedPath, lastIndexRef.current);
  lastIndexRef.current = focusedIndex;

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

  // Runs after every render; a no-op unless a keyboard move left a pending
  // target. Scrolling the target into view happens first (which re-renders,
  // so this effect runs again); the row is then focused once its own row
  // element exists in `rowRefs`.
  /* oxlint-disable react-hooks/exhaustive-deps -- runs after every render by design; the setState is guarded */
  useEffect(() => {
    const node = containerRef.current;
    const path = pendingFocusRef.current;
    if (node === null || path === null) {
      return;
    }
    const index = rows.findIndex((row) => row.path === path);
    if (index === -1) {
      // The row is not there yet — a create whose re-listing has not landed.
      // Leave the request armed; the next render tries again.
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
    rowRefs.current.get(path)?.focus();
    pendingFocusRef.current = null;
  });
  /* oxlint-enable react-hooks/exhaustive-deps */

  // A create asks for its own row by path (design §5.3), from the controller,
  // which cannot reach the DOM. The request is spent only once the row is
  // actually focusable — `pendingReveal`'s contract for the editor, applied to
  // the tree.
  //
  // `pendingTreeFocus.value` is read HERE, in the render body, and not inside
  // the effect. That read is what subscribes this component to the signal; a
  // signal touched only inside a no-deps effect never re-renders anything, so
  // the effect would not run again when the request arrives and the created
  // row would silently not take focus.
  const wantedFocus = pendingTreeFocus.value;
  useEffect(() => {
    if (wantedFocus === null || !rows.some((row) => row.path === wantedFocus)) {
      return;
    }
    setFocusedPath(wantedFocus);
    pendingFocusRef.current = wantedFocus;
    clearTreeFocus(wantedFocus);
  }, [wantedFocus, rows]);

  function activateRow(row: TreeRow): void {
    // The root is a directory row, but its expansion is `rootExpanded`, not a
    // member of `expanded` (design §3.3) — so it cannot go through
    // `toggleDirectory`.
    if (row.path === workspacePath) {
      controller.toggleRoot(workspacePath);
      return;
    }
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

  function handleRowClick(row: TreeRow, target: HTMLDivElement): void {
    setFocusedPath(row.path);
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
    // A cluster button on the root row is a descendant of the container that
    // holds this listener. Without this guard, Enter on "New File" ALSO ran
    // `activateRow(rows[0])` and collapsed the tree — `stopPropagation` on the
    // button's click covers the pointer path only (DL-27.1's
    // container-plus-hit-layer shape, applied to a row).
    if (
      event.target !== event.currentTarget &&
      !(event.target as HTMLElement).classList.contains("file-tree__row")
    ) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(rows.length - 1, focusedIndex + 1);
      pendingFocusRef.current = rows[next].path;
      setFocusedPath(rows[next].path);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, focusedIndex - 1);
      pendingFocusRef.current = rows[next].path;
      setFocusedPath(rows[next].path);
      return;
    }
    const row = rows[focusedIndex];
    if (row === undefined) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.path === workspacePath) {
        if (!row.expanded) {
          controller.toggleRoot(workspacePath);
        }
        return;
      }
      if (row.directory && canExpand(row) && !row.expanded) {
        controller.toggleDirectory(workspacePath, row.path);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.path === workspacePath) {
        if (row.expanded) {
          controller.toggleRoot(workspacePath);
        }
        return;
      }
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

  // The root row is always present, so `rows` is never empty and the old
  // "instead of the rows" status branches are gone: loading, empty and error
  // all KEEP the root row (design §3.3), which is what lets a workspace whose
  // listing failed still say which folder failed and still be refreshed.
  let status: ComponentChild = null;
  if (!loaded && !listingErrors.has(workspacePath)) {
    status = <p class="file-tree__status">Loading…</p>;
  } else if (loaded && surface.rootExpanded && rows.length === 1) {
    status = <p class="file-tree__status">No files</p>;
  }

  const body = (
    <div class="file-tree__rows" style={{ height: `${rows.length * ROW_HEIGHT}px` }}>
      {visible.map((row, offset) => {
        const index = startIndex + offset;
        const isRoot = row.path === workspacePath;
        return (
          <div
            key={row.path}
            ref={(el) => {
              if (el === null) {
                rowRefs.current.delete(row.path);
              } else {
                rowRefs.current.set(row.path, el);
              }
            }}
            role="treeitem"
            aria-expanded={row.directory ? row.expanded : undefined}
            aria-level={row.depth + 1}
            tabIndex={index === focusedIndex ? 0 : -1}
            // DL-19: data rows are 22px, one fixed indent token per depth.
            class={`file-tree__row${isRoot ? " is-root" : ""}`}
            style={{
              top: `${index * ROW_HEIGHT}px`,
              paddingLeft: `${8 + row.depth * 14}px`,
            }}
            title={isRoot ? workspacePath : undefined}
            onClick={(event) => handleRowClick(row, event.currentTarget as HTMLDivElement)}
            onDblClick={() => handleDoubleClick(row)}
          >
            <span
              class="file-tree__chevron"
              style={{ visibility: row.directory ? "visible" : "hidden" }}
            >
              <DeckIcon icon={chevronForRow(row)} size={ROW_ICON} />
            </span>
            {/* Design §3.2: no type glyph on the root — the caret at depth 0
                already says "this is the folder everything is in". */}
            {isRoot ? null : (
              <span class="file-tree__icon">
                <DeckIcon icon={iconForRow(row)} size={ROW_ICON} />
              </span>
            )}
            {/* DL-19: a data row keeps its content's real casing. */}
            <span class="file-tree__name">{row.name}</span>
          </div>
        );
      })}
    </div>
  );

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
        {status}
      </div>
    </div>
  );
}
