import { signal } from "@preact/signals";

/**
 * Which settings category the rail shows. A bare module signal, same idiom
 * as `chrome/events.ts`'s `settingsOpen` (R5) — window-scoped, not persisted.
 * Reopening settings in the same session returns to the last category; a
 * relaunch always starts back at "appearance".
 */
export type CategoryId =
  | "appearance"
  | "terminal"
  | "agents"
  | "links-editor"
  | "browser"
  | "shortcuts"
  | "notifications"
  // A view over MAIN-owned analytics consent (spec 2026-08-22 §7), not a
  // settings-schema pair — consent must never travel with copied settings.
  | "privacy"
  | "about"
  // A navigable stop since 2026-08-19 (owner), where it was a pinned rail-foot
  // action before — see the note on `SETTINGS_CATEGORIES`.
  | "reset";

export const activeCategory = signal<CategoryId>("appearance");
