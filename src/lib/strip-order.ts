/**
 * The strip's one ordering rule: a chip sits where it was opened, whatever
 * kind of chip it is (DL-18.6, 2026-08-16).
 *
 * Until then the strip was two segments — every terminal tab, a hairline,
 * then every non-terminal surface — and that shape was baked into the
 * KEYBOARD as well as the paint: `cycleTab` walked `tabs` then `surfaces`,
 * and ⌘1–9 counted terminal tabs only. Both now walk this merge instead, so
 * "the third chip" means the same thing to the eye and to the keymap.
 *
 * Pure arithmetic over order keys, in `src/lib/` rather than in either owner,
 * because it has exactly two consumers that must never disagree:
 * `TabManager` (keyboard) and `TabStrip` (paint). The seam is unchanged —
 * TabManager still learns nothing about files, only that a surface carries an
 * order key ([`SurfaceStrip.orderKey`](../terminal/tab-manager.ts)).
 */

/** Which owner a slot belongs to. */
export type StripSlotKind = 'tab' | 'surface';

/** One chip's position in the merged strip. */
export interface StripSlot {
  readonly kind: StripSlotKind;
  /**
   * Index within that owner's OWN list — a terminal tab index for `"tab"`, a
   * `SurfaceStrip` index for `"surface"`. Never an index into the merge:
   * every existing call (`selectTab`, `surfaces.activate`) speaks its owner's
   * index space, and translating here is what keeps them intact.
   */
  readonly index: number;
}

/** Anything the strip renders carries the key it was opened with. */
export interface StripOrderKey {
  readonly openedAt: number;
}

/**
 * Merge the two index spaces into the row the user sees.
 *
 * Ties fall back to the pre-2026-08-16 shape — every tab, then every surface,
 * each in its own order. That is not a hypothetical: `UNSEQUENCED` (0) is what
 * a fixture or a pre-order `TabView` reports, and a whole strip of them must
 * still render in a sensible order rather than an arbitrary one.
 */
export function mergeStripOrder(
  tabs: readonly StripOrderKey[],
  surfaces: readonly StripOrderKey[],
): readonly StripSlot[] {
  const entries = [
    ...tabs.map((tab, index) => ({
      slot: { kind: 'tab' as const, index },
      openedAt: tab.openedAt,
    })),
    ...surfaces.map((surface, index) => ({
      slot: { kind: 'surface' as const, index },
      openedAt: surface.openedAt,
    })),
  ];
  return entries
    .map((entry, position) => ({ ...entry, position }))
    .sort((a, b) => a.openedAt - b.openedAt || a.position - b.position)
    .map((entry) => entry.slot);
}
