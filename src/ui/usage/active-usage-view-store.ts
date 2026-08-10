import { signal } from "@preact/signals";

/**
 * Which view the usage rail shows. A bare module signal, the same idiom as
 * `settings/active-category-store.ts` and `chrome/events.ts`'s `settingsOpen`
 * (R5) — window-scoped, not persisted. Reopening the screen in the same
 * session returns to the last view; a relaunch always starts at "overview".
 */
export type UsageViewId = "overview" | "daily" | "breakdown";

export const activeUsageView = signal<UsageViewId>("overview");
