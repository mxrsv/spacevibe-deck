import { AREAS, SETTINGS, type AreaId, type MockSetting } from "./settings-data";
import { matchSettings } from "./settings-match";
import {
  AGENT_CONFIGS,
  RESET_SCOPES,
  SHORTCUTS,
  type HealthIssue,
  type MockAgentConfig,
  type MockShortcut,
} from "./settings-setup-data";
import { changedSettings, changedShortcuts, liveHealth } from "./settings-option-a-state";

/** What the list shows for the current query and scope, flattened so arrows can walk it. */
export type Item =
  | { readonly t: "head"; readonly key: string; readonly title: string }
  | { readonly t: "health"; readonly key: string; readonly issue: HealthIssue }
  | {
      readonly t: "setting";
      readonly key: string;
      readonly setting: MockSetting;
      readonly crumb?: boolean;
    }
  | { readonly t: "agent"; readonly key: string; readonly config: MockAgentConfig }
  | {
      readonly t: "shortcut";
      readonly key: string;
      readonly shortcut: MockShortcut;
      readonly crumb?: boolean;
    }
  | { readonly t: "area"; readonly key: string; readonly area: AreaId }
  | { readonly t: "preview"; readonly key: string }
  | { readonly t: "themes"; readonly key: string }
  | { readonly t: "update"; readonly key: string }
  | { readonly t: "privacy"; readonly key: string }
  | { readonly t: "reset"; readonly key: string; readonly id: string; readonly label: string }
  | { readonly t: "empty"; readonly key: string; readonly text: string };

const NAVIGABLE = new Set<Item["t"]>([
  "health",
  "setting",
  "agent",
  "shortcut",
  "area",
  "update",
  "reset",
]);

export function isNavigable(item: Item): boolean {
  return NAVIGABLE.has(item.t);
}

const FONT_KEYS = new Set(["fontFamily", "fontSize", "lineHeight"]);

const settingItem = (setting: MockSetting, crumb?: boolean): Item => ({
  t: "setting",
  key: `setting:${setting.key}`,
  setting,
  crumb,
});

/** The typography preview follows the last font row of a run, once. */
function withPreview(items: readonly Item[]): Item[] {
  const lastFont = items.reduce(
    (found, item, index) =>
      item.t === "setting" && FONT_KEYS.has(item.setting.key) ? index : found,
    -1,
  );
  const out = [...items];
  if (lastFont >= 0) out.splice(lastFont + 1, 0, { t: "preview", key: "preview" });
  return out;
}

function hitItems(query: string, scope: AreaId | null): Item[] {
  const hits = matchSettings(query).filter((hit) =>
    scope === null ? true : hit.area === scope && hit.kind !== "area",
  );
  if (hits.length === 0) return [{ t: "empty", key: "empty", text: query }];
  const out: Item[] = [];
  for (const area of AREAS) {
    const mine = hits.filter((hit) => hit.area === area.id);
    if (mine.length === 0) continue;
    if (scope === null) out.push({ t: "head", key: `head:${area.id}`, title: area.label });
    const rows: Item[] = [];
    for (const hit of mine) {
      if (hit.kind === "area") rows.push({ t: "area", key: `area:${hit.id}`, area: area.id });
      if (hit.kind === "setting") {
        const setting = SETTINGS.find((item) => item.key === hit.id);
        if (setting?.key === "themeId") rows.push({ t: "themes", key: "themes" });
        else if (setting) rows.push(settingItem(setting));
      }
      if (hit.kind === "agent") {
        const config = AGENT_CONFIGS.find((item) => item.id === hit.id);
        if (config) rows.push({ t: "agent", key: `agent:${config.id}`, config });
      }
      if (hit.kind === "shortcut") {
        const shortcut = SHORTCUTS.find((item) => item.id === hit.id);
        if (shortcut) rows.push({ t: "shortcut", key: `shortcut:${shortcut.id}`, shortcut });
      }
    }
    out.push(...withPreview(rows));
  }
  return out;
}

function homeItems(): Item[] {
  const out: Item[] = [];
  const health = liveHealth();
  if (health.length > 0) {
    out.push({ t: "head", key: "head:health", title: "Needs attention" });
    for (const issue of health) out.push({ t: "health", key: `health:${issue.id}`, issue });
  }
  const settings = changedSettings();
  const shortcuts = changedShortcuts();
  if (settings.length + shortcuts.length > 0) {
    out.push({ t: "head", key: "head:changed", title: "Changed" });
    out.push(...settings.map((setting) => settingItem(setting, true)));
    for (const shortcut of shortcuts) {
      out.push({ t: "shortcut", key: `shortcut:${shortcut.id}`, shortcut, crumb: true });
    }
  }
  return out;
}

function areaItems(area: AreaId): Item[] {
  switch (area) {
    case "agents":
      return AGENT_CONFIGS.map((config) => ({ t: "agent", key: `agent:${config.id}`, config }));
    case "shortcuts": {
      const out: Item[] = [];
      for (const group of ["Agents", "Panes", "Views", "App"] as const) {
        out.push({ t: "head", key: `head:${group}`, title: group });
        for (const shortcut of SHORTCUTS.filter((item) => item.group === group)) {
          out.push({ t: "shortcut", key: `shortcut:${shortcut.id}`, shortcut });
        }
      }
      return out;
    }
    case "about":
      return [{ t: "update", key: "update" }];
    case "privacy":
      return [{ t: "privacy", key: "privacy" }];
    case "reset":
      return RESET_SCOPES.map((item) => ({ t: "reset", key: `reset:${item.id}`, ...item }));
    default: {
      const out: Item[] = [];
      let group: string | undefined;
      for (const setting of SETTINGS.filter((item) => item.area === area)) {
        if (setting.key === "themeId") {
          out.push({ t: "themes", key: "themes" });
          group = setting.group;
          continue;
        }
        if (setting.group && setting.group !== group) {
          out.push({ t: "head", key: `head:${setting.group}`, title: setting.group });
        }
        group = setting.group;
        out.push(settingItem(setting));
      }
      return withPreview(out);
    }
  }
}

export function buildItems(query: string, scope: AreaId | null): Item[] {
  if (query.trim() !== "") return hitItems(query, scope);
  return scope === null ? homeItems() : areaItems(scope);
}
