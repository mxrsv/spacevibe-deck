import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import {
  bindingOf,
  chordConflicts,
  chordId,
  chordOf,
  chordsForAction,
  isOverridden,
  keymapPlatform,
  resolveKeymap,
  type Chord,
} from "../lib/keybindings";
import type { DesktopPlatform } from "../lib/platform";
import { formatShortcutBinding } from "../lib/shortcut-label";
import type { ActionId } from "../terminal/action-registry";
import {
  agentHit,
  areaHit,
  ATTENTION_TITLE,
  CHANGED_TITLE,
  settingHit,
  shortcutHit,
  type AttentionIssue,
  type CommandArea,
  type CommandAreaId,
  type CommandHit,
  type CommandItem,
  type IssueSeverity,
  type ReportedIssue,
  type ShortcutConflictIssue,
} from "./command-hits";
import { isMarkedChanged } from "./settings-changes";
import { SETTINGS_REGISTRY } from "./settings-registry";
import { agentChanged, SETTING_CONTROLS } from "./settings-rows";
import type { Settings } from "./settings-schema";
import { searchSettings } from "./settings-search";

/*
 * Command Settings: the one index behind the field. A query, an area scope or
 * neither becomes the flat list of `command-hits.ts`, from the registry, the
 * agents and the shortcut actions.
 */

/** One character matches nearly every label, so the broad lists wait for a second. */
export const MIN_FIELD_QUERY = 2;

export interface CommandShortcutGroup {
  readonly label: string;
  readonly rows: readonly { readonly action: ActionId; readonly label: string }[];
}

/** One snapshot of everything the list reads; the shell passes live values in. */
export interface CommandSources {
  readonly settings: Settings;
  /** In display order; `SETTINGS_CATEGORIES` fits. */
  readonly areas: readonly CommandArea[];
  /** The rebindable actions as the Shortcuts area groups them; `shortcutGroups()` fits. */
  readonly shortcuts: readonly CommandShortcutGroup[];
  /** The running platform: its keymap is the one shown and checked. */
  readonly platform: string;
  /** Problems a host or store knows about that no setting holds. */
  readonly reported?: readonly ReportedIssue[];
}

type SettingKey = keyof Settings;

const SETTING_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingKey[];

const SEVERITY_RANK: Readonly<Record<IssueSeverity, number>> = { error: 0, warning: 1, info: 2 };

/** A key drawn as a row of its own, rather than inside an agent or shortcut row. */
function isStandalone(key: SettingKey): boolean {
  const { kind } = SETTING_CONTROLS[key];
  return kind !== "agents" && kind !== "shortcuts" && kind !== "none";
}

/** Each agent with the command line its row shows (`catalogLaunchCommand`), so a flag finds it. */
function agentsOf(current: Settings): readonly { id: string; label: string; command: string }[] {
  return [
    ...BUILTIN_AGENTS.map((agent) => ({
      id: agent.id,
      label: agent.label,
      command: agent.defaultCommand ?? agent.id,
    })),
    ...current.customAgents,
  ];
}

function shortcutRows(sources: CommandSources) {
  return sources.shortcuts.flatMap((group) =>
    group.rows.map((row) => ({ ...row, group: group.label })),
  );
}

/** `CommandSources` carries the platform as a string; the chord formatter wants the app's own union. */
export function shortcutPlatform(platform: string): DesktopPlatform {
  return platform === "windows" ? "windows" : "macos";
}

const MODIFIER_NAMES: Readonly<Record<string, string>> = {
  "⌘": "cmd command",
  "⌥": "opt option alt",
  "⇧": "shift",
  "⌃": "ctrl control",
};

/** The chords an action answers to, as printed and as a person spells them: `⌘D` and `cmd d`. */
function chordText(
  keymap: ReturnType<typeof resolveKeymap>,
  platform: string,
  action: ActionId,
): string {
  const printed = chordsForAction(keymap, action).map((chord) =>
    formatShortcutBinding(bindingOf(chord, action), shortcutPlatform(platform)),
  );
  const spelled = printed.map((text) =>
    text.replace(/[⌘⌥⇧⌃]/gu, (glyph) => ` ${MODIFIER_NAMES[glyph]} `),
  );
  return [...printed, ...spelled].join(" ");
}

function hasAll(words: readonly string[], ...texts: readonly string[]): boolean {
  const haystack = texts.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Actions a user should look at once shortcuts come up: rebound or sharing a chord. */
function troubledActions(sources: CommandSources): ReadonlySet<ActionId> {
  const overrides = sources.settings.keybindings;
  const running = keymapPlatform(sources.platform);
  const conflicted = [...chordConflicts(resolveKeymap(sources.platform, overrides)).values()];
  const rebound = shortcutRows(sources)
    .map((row) => row.action)
    .filter((action) => isOverridden(overrides, running, action));
  return new Set([...conflicted.flat(), ...rebound]);
}

/** Hits for a query, best first. Inside an area scope only that area's rows remain. */
export function searchHits(
  query: string,
  scope: CommandAreaId | null,
  sources: CommandSources,
): readonly CommandHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return [];
  }
  const words = q.split(/\s+/);
  const broad = q.length >= MIN_FIELD_QUERY;
  const hits: CommandHit[] = [];
  let agentKeyMatched = false;
  let shortcutKeyMatched = false;
  for (const key of searchSettings(q).keys) {
    const { kind } = SETTING_CONTROLS[key];
    const page = SETTINGS_REGISTRY[key].page;
    if (kind === "agents") {
      agentKeyMatched = true;
    } else if (kind === "shortcuts") {
      shortcutKeyMatched = true;
    } else if (page !== null) {
      hits.push(settingHit(key, page));
    }
  }

  const agents = agentsOf(sources.settings);
  const named = agents.filter((agent) => hasAll(words, agent.label, agent.id, agent.command));
  // "signal", "model", "launch": a per-agent key matched, and it lives on every agent's row.
  const listed = named.length > 0 ? named : agentKeyMatched && broad ? agents : [];
  hits.push(...listed.map(agentHit));

  const rows = shortcutRows(sources);
  // A chord is typed with `+` between keys, and nothing else in the index is.
  const chordWords = q.replace(/\+/g, " ").split(/\s+/).filter(Boolean);
  const keymap = broad ? resolveKeymap(sources.platform, sources.settings.keybindings) : [];
  const matched = broad
    ? rows.filter((row) =>
        hasAll(chordWords, row.label, row.group, chordText(keymap, sources.platform, row.action)),
      )
    : [];
  hits.push(...matched.map(shortcutHit));
  if (shortcutKeyMatched) {
    // "keys", "hotkey": the setting itself matched, so offer the area and what needs a look there.
    const troubled = troubledActions(sources);
    hits.push(
      ...rows.filter((row) => !matched.includes(row) && troubled.has(row.action)).map(shortcutHit),
    );
    hits.push(...sources.areas.filter((area) => area.id === "shortcuts").map(areaHit));
  }
  hits.push(...sources.areas.filter((area) => hasAll(words, area.label)).map(areaHit));

  const unique = [...new Map(hits.map((hit) => [hit.id, hit])).values()];
  // Inside an area, an entry to an area is noise.
  const scoped =
    scope === null ? unique : unique.filter((hit) => hit.area === scope && hit.kind !== "area");
  return bestFirst(scoped, q);
}

/** A label that starts with the query beats one that contains it beats a keyword match. */
function bestFirst(hits: readonly CommandHit[], q: string): readonly CommandHit[] {
  const rank = (hit: CommandHit): number => {
    const label = hit.label.toLowerCase();
    return label.startsWith(q) ? 3 : label.includes(q) ? 2 : 1;
  };
  return hits
    .map((hit, index) => ({ hit, index, rank: rank(hit) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ hit }) => hit);
}

/**
 * Everything that differs from its default and has a reset of its own, in
 * area order: a preference row, an agent whose row or model defaults changed,
 * a rebound shortcut on the running platform. Layout and data keys never
 * appear, the same rule as the changed mark (`marksChange`).
 */
export function changedHits(sources: CommandSources): readonly CommandHit[] {
  const current = sources.settings;
  const settings = SETTING_KEYS.flatMap((key) => {
    const page = SETTINGS_REGISTRY[key].page;
    return page !== null && isStandalone(key) && isMarkedChanged(current, key)
      ? [settingHit(key, page)]
      : [];
  });
  const agents = agentsOf(current).filter((agent) => agentChanged(agent.id, current));
  const running = keymapPlatform(sources.platform);
  const shortcuts = shortcutRows(sources).filter((row) =>
    isOverridden(current.keybindings, running, row.action),
  );
  const order = (hit: CommandHit): number =>
    sources.areas.findIndex((area) => area.id === hit.area);
  return [...settings, ...agents.map(agentHit), ...shortcuts.map(shortcutHit)].sort(
    (a, b) => order(a) - order(b),
  );
}

/** Shortcut conflicts on the running platform, then reported problems, loudest first. */
export function attentionIssues(sources: CommandSources): readonly AttentionIssue[] {
  const keymap = resolveKeymap(sources.platform, sources.settings.keybindings);
  const chords = new Map<string, Chord>(
    keymap.map((binding) => [chordId(chordOf(binding)), chordOf(binding)]),
  );
  const conflicts: ShortcutConflictIssue[] = [];
  for (const [id, actions] of chordConflicts(keymap)) {
    const chord = chords.get(id);
    if (chord !== undefined) {
      conflicts.push({
        kind: "shortcut-conflict",
        id: `conflict:${id}`,
        severity: "warning",
        area: "shortcuts",
        chord,
        actions,
      });
    }
  }
  return [...conflicts, ...(sources.reported ?? [])].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

const hitItem = (hit: CommandHit, prefix = ""): CommandItem => ({
  type: "hit",
  key: `${prefix}${hit.id}`,
  hit,
});

const head = (key: string, title: string): CommandItem => ({ type: "head", key, title });

/** What the field shows: results for a query, else the area's rows, else the home lists. */
export function buildCommandItems(
  query: string,
  scope: CommandAreaId | null,
  sources: CommandSources,
): readonly CommandItem[] {
  if (query.trim() !== "") {
    return resultItems(query, scope, sources);
  }
  return scope === null ? homeItems(sources) : areaItems(scope, sources);
}

function resultItems(
  query: string,
  scope: CommandAreaId | null,
  sources: CommandSources,
): readonly CommandItem[] {
  const hits = searchHits(query, scope, sources);
  if (hits.length === 0) {
    return [{ type: "empty", key: "empty", query: query.trim() }];
  }
  if (scope !== null) {
    return hits.map((hit) => hitItem(hit));
  }
  // Areas in the order of their best hit, so the top result stays on top.
  const groups = new Map<CommandAreaId, CommandHit[]>();
  for (const hit of hits) {
    groups.set(hit.area, [...(groups.get(hit.area) ?? []), hit]);
  }
  return [...groups].flatMap(([area, list]) => [
    head(`head:${area}`, sources.areas.find((entry) => entry.id === area)?.label ?? area),
    ...list.map((hit) => hitItem(hit)),
  ]);
}

function homeItems(sources: CommandSources): readonly CommandItem[] {
  const issues = attentionIssues(sources);
  const changed = changedHits(sources);
  return [
    ...(issues.length === 0 ? [] : [head("head:attention", ATTENTION_TITLE)]),
    ...issues.map((issue): CommandItem => ({
      type: "attention",
      key: `attention:${issue.id}`,
      issue,
    })),
    ...(changed.length === 0 ? [] : [head("head:changed", CHANGED_TITLE)]),
    ...changed.map((hit) => hitItem(hit, "changed:")),
  ];
}

function areaItems(area: CommandAreaId, sources: CommandSources): readonly CommandItem[] {
  const settings = SETTING_KEYS.flatMap((key) => {
    const page = SETTINGS_REGISTRY[key].page;
    return page !== null && page === area && isStandalone(key)
      ? [hitItem(settingHit(key, page))]
      : [];
  });
  switch (area) {
    case "agents":
      return [...agentsOf(sources.settings).map((agent) => hitItem(agentHit(agent))), ...settings];
    case "shortcuts":
      return sources.shortcuts.flatMap((group) => [
        head(`head:${group.label}`, group.label),
        ...group.rows.map((row) => hitItem(shortcutHit(row))),
      ]);
    default:
      return settings.length > 0 ? settings : [{ type: "section", key: `section:${area}`, area }];
  }
}
