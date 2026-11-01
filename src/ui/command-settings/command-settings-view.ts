import { externalApp, type ExternalAppId } from "../../lib/external-app-catalog";
import { bindingOf, chordsForAction, resolveKeymap } from "../../lib/keybindings";
import { getDesktopEnvironment } from "../../lib/platform";
import { formatShortcutBinding } from "../../lib/shortcut-label";
import type {
  AttentionIssue,
  CommandAreaId,
  CommandHit,
  CommandItem,
} from "../../settings/command-hits";
import {
  buildCommandItems,
  shortcutPlatform,
  type CommandSources,
} from "../../settings/command-search";
import { settingRow } from "../../settings/settings-rows";
import type { Settings } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { getTheme } from "../../settings/themes";
import type { ActionId } from "../../terminal/action-registry";
import { SETTINGS_CATEGORIES } from "../settings/settings-categories";
import { reportedIssues } from "./command-settings-issues";
import { shortcutGroups } from "../settings/shortcut-groups";

/** The snapshot the list reads, taken from the live stores at render time. */
export function commandSources(): CommandSources {
  return {
    settings: settings.value,
    areas: SETTINGS_CATEGORIES.map(({ id, label }) => ({ id, label })),
    shortcuts: shortcutGroups(),
    platform: getDesktopEnvironment().platform,
    reported: reportedIssues(settings.value),
  };
}

/** What a live area cannot draw as a row: content with no registry key, or a kind a row does not edit. */
export type LegacyPiece =
  | "reset"
  | "theme"
  | "preview"
  | "logo"
  | "refresh"
  | "commands"
  | "identities"
  | "usage"
  | "resets"
  | "about";

/** The list as drawn: the model's items, plus the legacy pieces an area view mounts in place. */
export type ListItem =
  | CommandItem
  | {
      readonly type: "piece";
      readonly key: string;
      readonly area: CommandAreaId;
      readonly piece: LegacyPiece;
    };

/** The items the keyboard walks: pieces are not rows. */
export function commandItemsOf(items: readonly ListItem[]): readonly CommandItem[] {
  return items.filter((item): item is CommandItem => item.type !== "piece");
}

/** Areas whose settings no row edits yet: their own section is mounted as is. */
const SECTION_AREAS: ReadonlySet<CommandAreaId> = new Set(["privacy"]);

/** An area with nothing typed: its live rows, and the legacy pieces that have no row. */
function areaItems(area: CommandAreaId, sources: CommandSources): readonly ListItem[] {
  if (SECTION_AREAS.has(area)) {
    return [{ type: "section", key: `section:${area}`, area }];
  }
  const piece = (name: LegacyPiece): ListItem => ({
    type: "piece",
    key: `piece:${area}:${name}`,
    area,
    piece: name,
  });
  if (area === "reset") {
    return [piece("resets")];
  }
  if (area === "about") {
    return [piece("about")];
  }
  // The colour mode is edited by its cards, not by a row.
  const rows = buildCommandItems("", area, sources).filter(
    (item) => item.key !== "setting:themeId",
  );
  if (area === "agents") {
    // The rows are the agents and the pinned count; the forms that add a command or an agent,
    // and the usage link, have no row to draw and are mounted as they were.
    return [
      piece("reset"),
      piece("refresh"),
      ...rows,
      piece("commands"),
      piece("identities"),
      piece("usage"),
    ];
  }
  if (area !== "appearance") {
    return [piece("reset"), ...rows];
  }
  const afterType = rows.findIndex((item) => item.key === "setting:fontSize") + 1;
  return [
    piece("reset"),
    piece("theme"),
    ...rows.slice(0, afterType),
    piece("preview"),
    ...rows.slice(afterType),
    piece("logo"),
  ];
}

/** What the field shows: results for a query, else the area's rows, else the home lists. */
export function commandListItems(
  query: string,
  scope: CommandAreaId | null,
  sources: CommandSources,
): readonly ListItem[] {
  if (query.trim() === "" && scope !== null) {
    return areaItems(scope, sources);
  }
  return buildCommandItems(query, scope, sources);
}

export function areaLabel(area: CommandAreaId, sources: CommandSources): string {
  return sources.areas.find((entry) => entry.id === area)?.label ?? area;
}

export function settingValueText(key: keyof Settings, current: Settings): string {
  const { control, value } = settingRow(key, current);
  switch (control.kind) {
    case "switch":
      return value === true ? "On" : "Off";
    case "choice":
      return control.choices.find((choice) => choice.value === value)?.label ?? String(value);
    case "stepper":
      return `${String(value)}${control.unit}`;
    case "text":
    case "menu":
      return key === "externalAppId" ? externalApp(value as ExternalAppId).label : String(value);
    case "theme":
      return getTheme(String(value)).name;
    case "pins":
      return Array.isArray(value) ? `${value.length} pinned` : "automatic";
    default:
      return "";
  }
}

function chordText(action: ActionId, sources: CommandSources): string {
  const keymap = resolveKeymap(sources.platform, sources.settings.keybindings);
  const chords = chordsForAction(keymap, action);
  if (chords.length === 0) {
    return "Unbound";
  }
  return chords
    .map((chord) =>
      formatShortcutBinding(bindingOf(chord, action), shortcutPlatform(sources.platform)),
    )
    .join(" · ");
}

/** The value a hit row prints beside its label; an area entry has none. */
export function hitValueText(hit: CommandHit, sources: CommandSources): string {
  switch (hit.kind) {
    case "setting":
      return settingValueText(hit.key, sources.settings);
    case "agent":
      return sources.settings.disabledAgents.includes(hit.agentId) ? "Off" : "On";
    case "shortcut":
      return chordText(hit.action, sources);
    default:
      return "";
  }
}

/** The sentence an attention row reads as. */
export function issueText(issue: AttentionIssue, sources: CommandSources): string {
  if (issue.kind === "reported") {
    return issue.title;
  }
  const names = issue.actions.map(
    (action) =>
      sources.shortcuts.flatMap((group) => group.rows).find((row) => row.action === action)
        ?.label ?? action,
  );
  const keys = formatShortcutBinding(
    bindingOf(issue.chord, issue.actions[0]),
    shortcutPlatform(sources.platform),
  );
  return `${keys} is bound to ${names.join(" and ")}`;
}
