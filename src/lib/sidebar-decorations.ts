/**
 * Ornamental marks that may sit at the foot of the workspace sidebar (DL-16).
 *
 * Ids only. The artwork lives in `src/assets/decor/` and is attached in
 * `styles.css`, so this module stays a pure helper with no bundled asset
 * hanging off it — `sidebar-decoration.test.tsx` fails if an id here ever
 * loses its file or its rule.
 *
 * `off` is a member of the set rather than a separate boolean: one setting,
 * one closed list, and the settings cycle row gets its "none" position for
 * free instead of needing a toggle beside it.
 */
export type SidebarDecorationId =
  | "off"
  | "constellation"
  | "orbit"
  | "grid"
  | "waveform"
  | "comet";

/** Cycle order, as the settings row walks it. `off` leads, so the row starts
 *  and returns to "nothing shown". */
export const SIDEBAR_DECORATION_IDS: readonly SidebarDecorationId[] = [
  "off",
  "constellation",
  "orbit",
  "grid",
  "waveform",
  "comet",
];

/** Every id that actually paints something — i.e. all of them but `off`. */
export type SidebarDecorationArtId = Exclude<SidebarDecorationId, "off">;

export function isSidebarDecorationId(
  value: unknown,
): value is SidebarDecorationId {
  return SIDEBAR_DECORATION_IDS.includes(value as SidebarDecorationId);
}

/** The id after `current` in cycle order, wrapping at the end. */
export function nextSidebarDecoration(
  current: SidebarDecorationId,
): SidebarDecorationId {
  const index = SIDEBAR_DECORATION_IDS.indexOf(current);
  return SIDEBAR_DECORATION_IDS[(index + 1) % SIDEBAR_DECORATION_IDS.length];
}
