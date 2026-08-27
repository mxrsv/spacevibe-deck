/**
 * Where the explorer's keyboard focus is, as an INDEX derived from a PATH.
 *
 * `FileTreeView` held a `focusedIndex` until 2026-08-25. Creating an entry,
 * refreshing a directory or flipping `showHidden` re-sorts the rows, so the
 * same index names a different file — and design §5.3 requires focus to land
 * on a CREATED entry, which is an identity, not a position. The component
 * therefore tracks the path and derives the index here, every render.
 *
 * Pure: no DOM, no store, no host, so the whole policy is assertable as three
 * arguments and a number.
 */
import type { TreeRow } from "./file-tree";

/**
 * The index `focusedPath` occupies, or the nearest surviving row.
 *
 * `null` means the root, which is index 0 since the root became a row of the
 * model (design §3.1). A path that has left the tree clamps `fallbackIndex`
 * — the index that path last occupied — into the current bounds, so a
 * collapse or a delete leaves focus where the row used to be rather than
 * jumping to the top.
 */
export function resolveFocusIndex(
  rows: readonly TreeRow[],
  focusedPath: string | null,
  fallbackIndex: number,
): number {
  if (rows.length === 0) {
    return 0;
  }
  if (focusedPath === null) {
    return 0;
  }
  const found = rows.findIndex((row) => row.path === focusedPath);
  if (found !== -1) {
    return found;
  }
  return Math.min(Math.max(0, fallbackIndex), rows.length - 1);
}
