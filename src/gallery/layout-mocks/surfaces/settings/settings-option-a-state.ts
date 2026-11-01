import { signal } from "@preact/signals";
import { SETTINGS, type AreaId, type MockSetting } from "./settings-data";
import {
  HEALTH,
  SHORTCUTS,
  type HealthIssue,
  type MockAgentConfig,
  type MockShortcut,
} from "./settings-setup-data";

/**
 * Option A state: module-level signals, so the board shows the panel open, ⌘, and the rail's
 * Settings button reach the same instance, and the last scope survives closing.
 */

export type Value = boolean | string | number;
export type SaveState = "saved" | "saving" | "error";

const params = new URLSearchParams(window.location.search);
const isArea = (id: string | null): id is AreaId => SETTINGS_AREAS.has(id ?? "");
const SETTINGS_AREAS = new Set<string>([
  "appearance",
  "terminal",
  "agents",
  "shortcuts",
  "notifications",
  "browser",
  "links-editor",
  "about",
  "privacy",
  "reset",
]);

export const open = signal(params.get("open") === "1");
export const query = signal(params.get("q") ?? "");
const scopeParam = params.get("scope");
export const scope = signal<AreaId | null>(isArea(scopeParam) ? scopeParam : null);
/** The highlighted row, by key; falls back to the first row when the view no longer has it. */
export const activeKey = signal<string | null>(null);
/** Agent rows the user opened or closed; an agent that is the only hit opens on its own. */
export const expanded = signal<Readonly<Record<string, boolean>>>(
  params.get("expand") ? { [params.get("expand") as string]: true } : {},
);
export const recording = signal<string | null>(params.get("rec"));
/** The choice row whose menu Enter opened. */
export const openMenu = signal<string | null>(null);
export const resetTarget = signal<string | null>(params.get("dialog"));
export const save = signal<SaveState>(params.get("save") === "error" ? "error" : "saved");

const values = signal<Readonly<Record<string, Value>>>({});
const agentEdits = signal<Readonly<Record<string, Partial<AgentEdit>>>>({});
const chords = signal<Readonly<Record<string, readonly string[]>>>({});
const resolved = signal<ReadonlySet<string>>(new Set());
export const osOpened = signal(false);

export interface AgentEdit {
  readonly enabled: boolean;
  readonly pinned: boolean;
  readonly signalsOn: boolean;
  readonly model: string;
  readonly effort: "low" | "medium" | "high";
  readonly flags: string;
  readonly installed: boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Every edit saves: Saving for a beat, then Saved. */
export function touchSave(): void {
  clearTimeout(saveTimer);
  save.value = "saving";
  saveTimer = setTimeout(() => {
    save.value = "saved";
  }, 650);
}

export function currentValue(setting: MockSetting): Value {
  return values.value[setting.key] ?? setting.control.value;
}

export function isChanged(setting: MockSetting): boolean {
  return currentValue(setting) !== setting.control.fallback;
}

export function setValue(setting: MockSetting, value: Value, persist = true): void {
  values.value = { ...values.value, [setting.key]: value };
  if (persist) touchSave();
}

export function resetSetting(setting: MockSetting): void {
  setValue(setting, setting.control.fallback);
}

export function valueOf(key: string): Value | undefined {
  const setting = SETTINGS.find((item) => item.key === key);
  return setting ? currentValue(setting) : undefined;
}

export type AgentView = MockAgentConfig & { readonly flags: string };

export function agentView(config: MockAgentConfig): AgentView {
  const edit = agentEdits.value[config.id] ?? {};
  return {
    ...config,
    enabled: edit.enabled ?? config.enabled,
    pinned: edit.pinned ?? config.pinned,
    signalsOn: config.signalsOn === null ? null : (edit.signalsOn ?? config.signalsOn),
    model: edit.model ?? config.model,
    effort: edit.effort ?? config.effort,
    installed: edit.installed ?? config.installed,
    flags: edit.flags ?? config.profile?.flags ?? (config.kind === "custom" ? config.command : ""),
  };
}

export function editAgent(id: string, patch: Partial<AgentEdit>): void {
  agentEdits.value = { ...agentEdits.value, [id]: { ...agentEdits.value[id], ...patch } };
  touchSave();
}

export function chordOf(shortcut: MockShortcut): readonly string[] {
  return chords.value[shortcut.id] ?? shortcut.keys;
}

export function defaultChord(shortcut: MockShortcut): readonly string[] {
  return shortcut.fallback ?? shortcut.keys;
}

export function chordChanged(shortcut: MockShortcut): boolean {
  return chordOf(shortcut).join("") !== defaultChord(shortcut).join("");
}

export function setChord(id: string, keys: readonly string[]): void {
  chords.value = { ...chords.value, [id]: keys };
  touchSave();
}

/** Another shortcut that holds the same chord, if any. */
export function conflictOf(shortcut: MockShortcut): MockShortcut | undefined {
  const keys = chordOf(shortcut).join("");
  if (keys === "") return undefined;
  return SHORTCUTS.find((other) => other.id !== shortcut.id && chordOf(other).join("") === keys);
}

/** The row keeps the chord; the other action loses it. */
export function reassign(shortcut: MockShortcut): void {
  const other = conflictOf(shortcut);
  if (other) setChord(other.id, []);
}

export function liveHealth(): readonly HealthIssue[] {
  return HEALTH.filter((issue) => {
    if (issue.id === "shortcut-conflict") return SHORTCUTS.some((item) => conflictOf(item));
    return !resolved.value.has(issue.id);
  });
}

export function resolveHealth(issue: HealthIssue): void {
  switch (issue.id) {
    case "notifications-blocked":
      osOpened.value = true;
      return;
    case "shortcut-conflict": {
      scope.value = "shortcuts";
      query.value = "";
      const clash = SHORTCUTS.find((item) => conflictOf(item));
      activeKey.value = clash ? `shortcut:${clash.id}` : null;
      return;
    }
    case "opencode-signals":
      editAgent("opencode", { signalsOn: true });
      break;
    case "droid-missing":
      editAgent("droid", { installed: true });
      break;
    default:
      touchSave();
  }
  resolved.value = new Set([...resolved.value, issue.id]);
}

export function changedSettings(): readonly MockSetting[] {
  return SETTINGS.filter(isChanged);
}

export function changedShortcuts(): readonly MockShortcut[] {
  return SHORTCUTS.filter(chordChanged);
}

export function resetScope(id: string): void {
  if (id === "settings") {
    values.value = {};
    chords.value = {};
  } else if (id === "agents") {
    agentEdits.value = {};
  }
  resolved.value = new Set();
  touchSave();
}

export function retrySave(): void {
  touchSave();
}

export function closePanel(): void {
  open.value = false;
  query.value = "";
  recording.value = null;
  openMenu.value = null;
}

export function togglePanel(): void {
  if (open.value) closePanel();
  else open.value = true;
}
