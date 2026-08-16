/**
 * The window's one open-order clock.
 *
 * Since 2026-08-16 the strip is a single row ordered by when each chip was
 * opened (DL-18.6), and its chips come from three owners that deliberately
 * never see each other: terminal tabs (`TabManager`), the active workspace's
 * file tabs (the file store) and the browser tab (its own store). A counter
 * per owner would only order that owner's own chips against each other; one
 * counter shared by all three is what makes "the order you opened them in" a
 * single answer instead of three.
 *
 * Window-scoped module state (R5): every window runs its own renderer, so the
 * counter starts fresh per window and never has to be partitioned.
 *
 * Strictly increasing and never reused. A closed chip does not give its key
 * back, so reopening a file lands it at the END of the strip rather than back
 * in the slot it used to hold — which is what "the order you opened them in"
 * means for a file you just reopened.
 */

/**
 * Order key for a chip whose owner never assigned one — a test fixture, a
 * gallery seed, or a `TabView` built before this field existed. Sorts before
 * every real key, so an unsequenced set keeps the terminals-then-surfaces
 * shape the strip had until 2026-08-16.
 */
export const UNSEQUENCED = 0;

let last = UNSEQUENCED;

/** The next order key. Strictly increasing within this window. */
export function nextOpenSequence(): number {
  last += 1;
  return last;
}

/** Test seam, mirroring `resetFileSurfaces`/`resetBrowserStore`: module state
 * outlives a single test, and a test that asserts an exact order key needs a
 * known starting point. Production never calls this. */
export function resetOpenSequence(): void {
  last = UNSEQUENCED;
}
