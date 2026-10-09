/**
 * Marks the document on the stage in the explorer tree and brings its row into
 * view (EXP2, DL-19.10).
 *
 * The mark is DERIVED: the row whose path is the active file tab's, while that
 * tab belongs to this workspace. A terminal holding the stage clears
 * `activeFileTab`, so nothing is marked then — the mark names what the stage
 * shows, not what the workspace last opened.
 *
 * The reveal is a REQUEST, armed by three events only — the marked document
 * changing (a mount with one counts), and hidden files turning on — and spent
 * as soon as it finishes. It never re-arms on a re-render, so a collapse or a
 * scroll the user makes afterwards stands. While armed it follows the store:
 * each change asks `nextRevealStep` for the next move and makes it through the
 * controller, which is also the only thing allowed to restate the watch scope.
 * It never focuses a row, and `scrollIntoView` is not used: the tree's rows are
 * windowed and absolutely positioned, so the scroll offset is index arithmetic.
 */
import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { FileSurfaceController } from "../file-surface-controller";
import { activeFileTab, listingErrorsFor, surfaceFor, treeRows } from "../file-surface-store";
import { hasTab } from "../preview-slot";
import { nextRevealStep } from "../tree-reveal";

export interface RevealActiveDocumentOptions {
  readonly controller: FileSurfaceController;
  readonly workspacePath: string;
  readonly containerRef: RefObject<HTMLDivElement>;
  readonly rowHeight: number;
  /** The scroll offset the reveal set, so the window follows it. */
  onScrolled(scrollTop: number): void;
}

/** The path to mark, or null. */
export function useRevealActiveDocument(options: RevealActiveDocumentOptions): string | null {
  const { controller, workspacePath, containerRef, rowHeight, onScrolled } = options;
  const surface = surfaceFor(workspacePath);
  const active = activeFileTab.value;
  const marked = active !== null && hasTab(surface.tabs, active) ? active : null;
  const listingErrors = listingErrorsFor(workspacePath);
  // A string, so the effect below runs when a directory FAILS, which is what
  // turns a wait into a `none`, without running on every new empty Map.
  const failed = [...listingErrors.keys()].join("\0");

  const request = useRef<string | null>(null);
  const armedFor = useRef<string | null>(null);
  const hiddenBefore = useRef(surface.showHidden);

  useEffect(() => {
    const key = `${workspacePath}\0${marked ?? ""}`;
    const turnedOn = surface.showHidden && !hiddenBefore.current;
    hiddenBefore.current = surface.showHidden;
    if (armedFor.current !== key || turnedOn) {
      // A newer document replaces one still in flight.
      armedFor.current = key;
      request.current = marked;
    }
    const target = request.current;
    if (target === null) {
      return;
    }
    const step = nextRevealStep({
      target,
      root: workspacePath,
      listings: surface.listings,
      expanded: surface.expanded,
      rootExpanded: surface.rootExpanded,
      showHidden: surface.showHidden,
      listingErrors,
    });
    if (step.kind === "wait") {
      return;
    }
    if (step.kind === "open-root") {
      controller.toggleRoot(workspacePath);
      return;
    }
    if (step.kind === "expand") {
      controller.toggleDirectory(workspacePath, step.directory);
      return;
    }
    request.current = null;
    const node = containerRef.current;
    if (step.kind === "none" || node === null || node.clientHeight === 0) {
      return;
    }
    const index = treeRows(workspacePath).findIndex((row) => row.path === target);
    if (index === -1) {
      return;
    }
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    let next = node.scrollTop;
    if (top < next) {
      next = top;
    } else if (bottom > next + node.clientHeight) {
      next = bottom - node.clientHeight;
    }
    if (next !== node.scrollTop) {
      node.scrollTop = next;
      onScrolled(next);
    }
    // The inputs are the store slices the step reads, not their wrappers: the
    // surface object is new on every write and `listingErrors` on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    controller,
    workspacePath,
    marked,
    surface.showHidden,
    surface.listings,
    surface.expanded,
    surface.rootExpanded,
    failed,
  ]);

  return marked;
}
