/**
 * New active tab index after removing the tab at `removeAt` from a list that
 * held `countBefore` tabs. Pure — this is the index math that must survive a
 * concurrent Close (the caller re-derives `removeAt` after any `await`, then
 * drives all shifting through here). Returns -1 when no tabs remain.
 */
export function activeAfterClose(removeAt: number, active: number, countBefore: number): number {
  const countAfter = countBefore - 1;
  if (countAfter <= 0) {
    return -1;
  }
  let next = active;
  // A removal left of the active tab shifts it one slot toward index 0.
  if (removeAt < active) {
    next -= 1;
  }
  // Clamp when the active tab itself (or a tab past it) was the last one.
  if (next >= countAfter) {
    next = countAfter - 1;
  }
  return next;
}
