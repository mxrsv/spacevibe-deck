import type { CommandHit } from "../../settings/command-hits";
import { SETTING_CONTROLS } from "../../settings/settings-rows";
import type { Settings } from "../../settings/settings-schema";

/*
 * Which hits a row edits in place: a setting of a kind a control draws, a shortcut and an agent.
 * Every other hit (the theme cards) is edited by a legacy piece, so it stays a stand-in row that
 * opens the area. A leaf module: the state module needs it, and that one
 * must not reach a store.
 */

const LIVE_KINDS: ReadonlySet<string> = new Set([
  "switch",
  "choice",
  "stepper",
  "text",
  "menu",
  "pins",
]);

export function isLiveKey(key: keyof Settings): boolean {
  return LIVE_KINDS.has(SETTING_CONTROLS[key].kind);
}

/** A hit with a control in its row: a setting a row edits, or a shortcut. */
export function isLiveHit(hit: CommandHit): boolean {
  return (
    hit.kind === "shortcut" ||
    hit.kind === "agent" ||
    (hit.kind === "setting" && isLiveKey(hit.key))
  );
}

/** The key a live row of this setting has in the list. */
export const settingRowKey = (key: keyof Settings): string => `setting:${key}`;

export const rowDomId = (key: string): string => `command-row-${key}`;

/** Marks a row whose control is in the row: Enter moves focus into it, Escape brings it back. */
export const LIVE_ROW_ATTRIBUTE = "data-command-live-row";
