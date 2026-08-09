/**
 * Where a dragged row lands, worked out from row midpoints alone.
 *
 * Split out of the sidebar because it is the only part of a drag that can be
 * reasoned about without a pointer: geometry in, two indices out.
 */
export interface ReorderDrop {
  /**
   * Insertion gap in the list **as drawn** — 0 is above the first row,
   * `rows.length` is below the last. This is what the insertion line marks.
   */
  readonly gap: number;
  /**
   * Destination index for the move itself, i.e. the gap re-expressed for a
   * list the dragged row has already left. Equal to `from` when the drag has
   * not left its own slot, so callers can treat it as a no-op.
   */
  readonly to: number;
}

/**
 * Rows are ordered top to bottom and `midpoints[i]` is row `i`'s vertical
 * centre in the same coordinate space as `pointerY` (client px). The pointer
 * belongs to the gap after every midpoint it has passed — comparing against
 * centres rather than edges is what makes the line flip exactly halfway
 * through a row instead of at the moment the pointer enters it.
 */
export function reorderDropAt(
  midpoints: readonly number[],
  pointerY: number,
  from: number,
): ReorderDrop {
  let gap = 0;
  for (const midpoint of midpoints) {
    if (pointerY > midpoint) {
      gap += 1;
    }
  }
  // Past its own slot the gap counts a row that will not be there any more,
  // so the destination index is one lower than the visual gap.
  return { gap, to: gap > from ? gap - 1 : gap };
}
