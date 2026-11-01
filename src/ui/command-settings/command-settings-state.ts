import { signal } from "@preact/signals";
import type { CommandAreaId } from "../../settings/command-hits";

/*
 * Command Settings keeps its state in module signals, like the screen it
 * replaces (R5): window-scoped and session-only, so reopening Settings returns
 * to the last area and nothing here is persisted. A leaf module on purpose:
 * `openSettingsAt` imports it, so it must not import that store back.
 */

/** The text in the one field. */
export const commandQuery = signal("");

/** The area the field is scoped to, or null for the whole index. */
export const commandScope = signal<CommandAreaId | null>(null);

/** The highlighted row, by key; the list falls back to its first row when it no longer holds it. */
export const commandActiveKey = signal<string | null>(null);

/**
 * Show one area with nothing typed: the entrance every deep link and every row takes. A row key
 * the area lists becomes the active row (the surface scrolls it into view); null, or a key the
 * area does not list, opens it on its first row.
 */
export function revealInCommand(area: CommandAreaId, rowKey: string | null = null): void {
  commandQuery.value = "";
  commandScope.value = area;
  commandActiveKey.value = rowKey;
}
