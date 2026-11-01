import { signal } from "@preact/signals";
import { settingsOpen } from "../../chrome/events";
import type { Settings } from "../../settings/settings-schema";
import { isLiveKey, settingRowKey } from "../command-settings/command-settings-live";
import { revealInCommand } from "../command-settings/command-settings-state";
import { activeCategory, type CategoryId } from "./active-category-store";

/** The rail's search field. Window-scoped like `activeCategory` (R5). */
export const settingsQuery = signal("");

/** A row a deep link asked to reveal; the row scrolls to itself and highlights. */
export const settingsTarget = signal<keyof Settings | null>(null);

/**
 * Opens Settings on a page, and on one row of it when `key` is given (SET-3).
 * Command Settings reads the same call as "scope to this area, and make this
 * row the active one"; a legacy piece inside the area still paints its row from
 * `settingsTarget`, as the screen does.
 */
export function openSettingsAt(page: CategoryId, key?: keyof Settings): void {
  settingsQuery.value = "";
  activeCategory.value = page;
  settingsTarget.value = key ?? null;
  revealInCommand(page, key !== undefined && isLiveKey(key) ? settingRowKey(key) : null);
  settingsOpen.value = true;
}
