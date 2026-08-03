import { signal } from "@preact/signals";

/**
 * Which settings category the rail shows. A bare module signal, same idiom
 * as `chrome/events.ts`'s `settingsOpen` (R5) — window-scoped, not persisted.
 * Reopening settings in the same session returns to the last category; a
 * relaunch always starts back at "appearance".
 */
export type CategoryId =
  | "appearance"
  | "colors"
  | "terminal"
  | "links-editor"
  | "notifications";

export const activeCategory = signal<CategoryId>("appearance");
