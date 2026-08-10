import { signal } from "@preact/signals";
import { DEFAULT_USAGE_RANGE, type UsageRangeId } from "./usage-ranges";

/**
 * Which view the usage rail shows. A bare module signal, the same idiom as
 * `settings/active-category-store.ts` and `chrome/events.ts`'s `settingsOpen`
 * (R5) — window-scoped, not persisted. Reopening the screen in the same
 * session returns to the last view; a relaunch always starts at "overview".
 */
export type UsageViewId = "overview" | "daily" | "breakdown";

export const activeUsageView = signal<UsageViewId>("overview");

/**
 * Which period the overview's display figure covers (DL-16.7).
 *
 * Transient view state and deliberately NOT a setting: it is not written to
 * the settings store and it is reset when the screen closes, for the reason
 * DL-13.6 gives about half-finished state. A figure silently scoped to a
 * period the reader chose last week is worse than one that always opens
 * whole, because nothing on screen would explain why the number shrank.
 */
export const activeUsageRange = signal<UsageRangeId>(DEFAULT_USAGE_RANGE);
