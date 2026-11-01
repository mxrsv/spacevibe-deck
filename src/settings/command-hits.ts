import type { Chord } from "../lib/keybindings";
import type { ActionId } from "../terminal/action-registry";
import { SETTINGS_REGISTRY, type SettingsPage } from "./settings-registry";
import type { Settings } from "./settings-schema";

/*
 * Command Settings: what a hit is and the flat list the one field shows. Every
 * hit is drawn as a live row, never as a link to a page. Nothing here reads a
 * store: the shell passes its snapshot in.
 */

/** The registry's pages plus the three areas that hold no key; equal to `CategoryId` (tested). */
export type CommandAreaId = SettingsPage | "about" | "privacy" | "reset";

export interface CommandArea {
  readonly id: CommandAreaId;
  readonly label: string;
}

export type CommandHit =
  | {
      readonly kind: "setting";
      readonly id: string;
      readonly area: SettingsPage;
      readonly label: string;
      readonly key: keyof Settings;
    }
  | {
      readonly kind: "agent";
      readonly id: string;
      readonly area: "agents";
      readonly label: string;
      readonly agentId: string;
    }
  | {
      readonly kind: "shortcut";
      readonly id: string;
      readonly area: "shortcuts";
      readonly label: string;
      readonly action: ActionId;
    }
  | {
      readonly kind: "area";
      readonly id: string;
      readonly area: CommandAreaId;
      readonly label: string;
    };

export type IssueSeverity = "error" | "warning" | "info";

/**
 * Something in the setup to fix, loudest first. A shortcut conflict is read
 * from the settings; a `reported` issue comes from a host or store fact no
 * setting holds, so its caller names it.
 */
export type AttentionIssue = ShortcutConflictIssue | ReportedIssue;

export interface ShortcutConflictIssue {
  readonly kind: "shortcut-conflict";
  readonly id: string;
  readonly severity: "warning";
  readonly area: "shortcuts";
  readonly chord: Chord;
  /** Every action holding the chord, in keymap order (the user's newest choice first). */
  readonly actions: readonly ActionId[];
}

export interface ReportedIssue {
  readonly kind: "reported";
  readonly id: string;
  readonly severity: IssueSeverity;
  readonly area: CommandAreaId;
  readonly title: string;
  /** The list key of the row that resolves it, when the area lists one. */
  readonly row?: string;
}

/**
 * One line of the list. Keys are unique within a list, so arrows can walk it
 * by key: a hit that also sits in the Changed list carries a different key
 * there. A `section` stands for an area with no registry rows, whose own
 * Settings section is mounted as is.
 */
export type CommandItem =
  | { readonly type: "head"; readonly key: string; readonly title: string }
  | { readonly type: "hit"; readonly key: string; readonly hit: CommandHit }
  | { readonly type: "attention"; readonly key: string; readonly issue: AttentionIssue }
  | { readonly type: "section"; readonly key: string; readonly area: CommandAreaId }
  | { readonly type: "empty"; readonly key: string; readonly query: string };

export const ATTENTION_TITLE = "Needs attention";
export const CHANGED_TITLE = "Changed";

export function settingHit(key: keyof Settings, area: SettingsPage): CommandHit {
  return { kind: "setting", id: `setting:${key}`, area, label: SETTINGS_REGISTRY[key].label, key };
}

export function agentHit(agent: { readonly id: string; readonly label: string }): CommandHit {
  return {
    kind: "agent",
    id: `agent:${agent.id}`,
    area: "agents",
    label: agent.label,
    agentId: agent.id,
  };
}

export function shortcutHit(row: {
  readonly action: ActionId;
  readonly label: string;
}): CommandHit {
  return {
    kind: "shortcut",
    id: `shortcut:${row.action}`,
    area: "shortcuts",
    label: row.label,
    action: row.action,
  };
}

export function areaHit(area: CommandArea): CommandHit {
  return { kind: "area", id: `area:${area.id}`, area: area.id, label: area.label };
}

export function isNavigable(item: CommandItem): boolean {
  return item.type === "hit" || item.type === "attention";
}

/** The row the list highlights: the active key while the list holds it, else the first row. */
export function activeKeyIn(
  items: readonly CommandItem[],
  activeKey: string | null,
): string | null {
  const keys = items.filter(isNavigable).map((item) => item.key);
  return activeKey !== null && keys.includes(activeKey) ? activeKey : (keys[0] ?? null);
}

/** Arrow keys: step over heads and empty lines, and stop at either end. */
export function moveActive(
  items: readonly CommandItem[],
  activeKey: string | null,
  delta: number,
): string | null {
  const keys = items.filter(isNavigable).map((item) => item.key);
  const current = activeKeyIn(items, activeKey);
  if (current === null) {
    return null;
  }
  const next = Math.min(keys.length - 1, Math.max(0, keys.indexOf(current) + delta));
  return keys[next];
}
