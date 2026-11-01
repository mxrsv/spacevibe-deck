import { AREAS, SETTINGS, areaById, type AreaId } from "./settings-data";
import { AGENT_CONFIGS, SHORTCUTS } from "./settings-setup-data";

export interface SettingHit {
  readonly kind: "setting" | "agent" | "shortcut" | "area";
  readonly id: string;
  readonly label: string;
  readonly area: AreaId;
}

/** Every whitespace-separated word must appear in the label, keywords or area name. */
export function matchSettings(query: string): readonly SettingHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (...texts: readonly string[]) => {
    const haystack = texts.join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  return [
    ...AREAS.filter((area) => matches(area.label)).map((area): SettingHit => ({
      kind: "area",
      id: area.id,
      label: area.label,
      area: area.id,
    })),
    ...SETTINGS.filter((setting) =>
      matches(setting.label, ...setting.keywords, areaById(setting.area).label),
    ).map((setting): SettingHit => ({
      kind: "setting",
      id: setting.key,
      label: setting.label,
      area: setting.area,
    })),
    ...AGENT_CONFIGS.filter((agent) => matches(agent.name, agent.command, "agent")).map(
      (agent): SettingHit => ({ kind: "agent", id: agent.id, label: agent.name, area: "agents" }),
    ),
    ...SHORTCUTS.filter((shortcut) => matches(shortcut.label, "shortcut key")).map(
      (shortcut): SettingHit => ({
        kind: "shortcut",
        id: shortcut.id,
        label: shortcut.label,
        area: "shortcuts",
      }),
    ),
  ];
}
