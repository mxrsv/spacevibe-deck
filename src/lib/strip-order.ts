/**
 * The strip's shared order: pinned chips first, then manual placement,
 * falling back to open order for new chips (DL-18.10, DECK-45).
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

import { signal } from "@preact/signals";

export interface StripPreferences {
  readonly order: readonly number[];
  readonly pinned: readonly number[];
}

export const EMPTY_STRIP_PREFERENCES: StripPreferences = { order: [], pinned: [] };

/** Window-local presentation preferences, shared by the chips and keyboard.
 * Open keys are identities: never rewrite them or reorder a PTY owner's array.
 * Preferences survive layout/workspace switches, not an application restart. */
export const stripPreferences = signal<StripPreferences>(EMPTY_STRIP_PREFERENCES);

export function setStripPinned(key: number, pinned: boolean): void {
  if (key <= 0) return;
  const current = stripPreferences.value;
  stripPreferences.value = {
    ...current,
    pinned: pinned
      ? [...new Set([...current.pinned, key])]
      : current.pinned.filter((item) => item !== key),
  };
}

/** Move within one pin group, replacing only visible positions. Hidden
 * workspaces keep their relative order. New chips append in open order. */
export function moveStripTab(
  source: number,
  before: number | null,
  visible: readonly number[],
  all: readonly number[],
): void {
  const current = stripPreferences.value;
  const pinned = new Set(current.pinned);
  const group = visible.filter((key) => key > 0 && pinned.has(key) === pinned.has(source));
  if (!group.includes(source) || source === before || (before !== null && !group.includes(before)))
    return;
  const rest = group.filter((key) => key !== source);
  const at = before === null ? rest.length : rest.indexOf(before);
  const moved = [...rest.slice(0, at), source, ...rest.slice(at)];
  const keys = [...new Set(all.filter((key) => key > 0))];
  const ordered = mergeStripOrder(
    keys.map((openedAt) => ({ openedAt })),
    [],
    current,
  ).map((slot) => keys[slot.index]!);
  let index = 0;
  stripPreferences.value = {
    order: ordered.map((key) => (group.includes(key) ? moved[index++]! : key)),
    pinned: current.pinned.filter((key) => keys.includes(key)),
  };
}

/** Which owner a slot belongs to. */
export type StripSlotKind = "tab" | "surface";

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
  preferences: StripPreferences = EMPTY_STRIP_PREFERENCES,
): readonly StripSlot[] {
  const ranks = new Map(preferences.order.map((key, index) => [key, index]));
  const pinned = new Set(preferences.pinned);
  const entries = [
    ...tabs.map((tab, index) => ({
      slot: { kind: "tab" as const, index },
      openedAt: tab.openedAt,
    })),
    ...surfaces.map((surface, index) => ({
      slot: { kind: "surface" as const, index },
      openedAt: surface.openedAt,
    })),
  ];
  return entries
    .map((entry, position) => ({ ...entry, position }))
    .sort(
      (a, b) =>
        Number(pinned.has(b.openedAt)) - Number(pinned.has(a.openedAt)) ||
        (ranks.get(a.openedAt) ?? preferences.order.length) -
          (ranks.get(b.openedAt) ?? preferences.order.length) ||
        a.openedAt - b.openedAt ||
        a.position - b.position,
    )
    .map((entry) => entry.slot);
}
