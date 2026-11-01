import {
  SETTINGS_REGISTRY,
  type SettingScope,
  type SettingsPage,
} from "../../../../settings/settings-registry";
import type { Settings } from "../../../../settings/settings-schema";

/**
 * The one Settings scenario every option draws, so options differ in structure only. Labels,
 * keywords, scope and page come from the real `SETTINGS_REGISTRY`; values, agents, shortcuts and
 * the health facts are illustrative. Areas are today's ten Settings categories.
 */

export type AreaId = SettingsPage | "about" | "privacy" | "reset";

export interface SettingsArea {
  readonly id: AreaId;
  readonly label: string;
}

export const AREAS: readonly SettingsArea[] = [
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "agents", label: "Agents" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "notifications", label: "Notifications" },
  { id: "browser", label: "Browser" },
  { id: "links-editor", label: "Links & editor" },
  { id: "about", label: "About" },
  { id: "privacy", label: "Privacy" },
  { id: "reset", label: "Reset" },
];

export function areaById(id: AreaId): SettingsArea {
  const area = AREAS.find((item) => item.id === id);
  if (!area) throw new Error(`Unknown settings area: ${id}`);
  return area;
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

/** The value kinds a single-key row edits. Compound editors (agents, shortcuts) are below. */
export type Control =
  | { readonly kind: "switch"; readonly value: boolean; readonly fallback: boolean }
  | {
      readonly kind: "choice";
      readonly value: string;
      readonly fallback: string;
      readonly choices: readonly Choice[];
    }
  | {
      readonly kind: "number";
      readonly value: number;
      readonly fallback: number;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly unit?: string;
    }
  | { readonly kind: "text"; readonly value: string; readonly fallback: string };

/**
 * Rows the Settings spec plans but no `Settings` key holds yet: terminal typography (TYP-1) and
 * notification rules and sound (NTF-1, NTF-2). They carry `planned: true`.
 */
export type PlannedKey =
  | "lineHeight"
  | "cursorStyle"
  | "cursorBlink"
  | "turnCompleteAlert"
  | "needsInputAlert"
  | "alertSound";

export interface MockSetting {
  readonly key: keyof Settings | PlannedKey;
  readonly planned?: true;
  readonly area: SettingsPage;
  /** A heading inside the area, when the area has more than one group. */
  readonly group?: string;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly scope: SettingScope;
  readonly control: Control;
  /** Where the effect shows in the shell, for options that point at it. */
  readonly region?: ShellRegion;
}

/** The parts of the hybrid shell a setting changes, for in-place options. */
export type ShellRegion = "rail" | "stage-bar" | "terminal" | "dock" | "status-bar" | "browser";

function fromRegistry(
  key: keyof Settings,
  control: Control,
  extra: { readonly group?: string; readonly region?: ShellRegion } = {},
): MockSetting {
  const entry = SETTINGS_REGISTRY[key];
  if (entry.page === null) throw new Error(`${key} has no Settings page`);
  return {
    key,
    area: entry.page,
    label: entry.label,
    keywords: entry.keywords,
    scope: entry.scope,
    control,
    ...extra,
  };
}

function planned(
  key: PlannedKey,
  area: SettingsPage,
  label: string,
  control: Control,
  extra: {
    readonly group?: string;
    readonly region?: ShellRegion;
    readonly keywords?: readonly string[];
  } = {},
): MockSetting {
  const { keywords = [], ...rest } = extra;
  return { key, planned: true, area, label, keywords, scope: "preference", control, ...rest };
}

/** Single-key rows, in the order an area lists them. */
export const SETTINGS: readonly MockSetting[] = [
  fromRegistry(
    "themeId",
    {
      kind: "choice",
      value: "dark",
      fallback: "dark",
      choices: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "System" },
      ],
    },
    { group: "Theme", region: "rail" },
  ),
  fromRegistry(
    "fontFamily",
    {
      kind: "choice",
      value: "JetBrains Mono",
      fallback: "SF Mono",
      choices: ["SF Mono", "JetBrains Mono", "Berkeley Mono", "Menlo"].map((name) => ({
        value: name,
        label: name,
      })),
    },
    { group: "Text", region: "terminal" },
  ),
  fromRegistry(
    "fontSize",
    { kind: "number", value: 14, fallback: 13, min: 9, max: 24, step: 1, unit: "px" },
    { group: "Text", region: "terminal" },
  ),
  fromRegistry(
    "showPaneBar",
    { kind: "switch", value: false, fallback: false },
    { group: "Chrome", region: "terminal" },
  ),
  fromRegistry(
    "showStatusBar",
    { kind: "switch", value: true, fallback: false },
    { group: "Chrome", region: "status-bar" },
  ),
  fromRegistry(
    "tabBarPosition",
    {
      kind: "choice",
      value: "left",
      fallback: "left",
      choices: [
        { value: "left", label: "Left" },
        { value: "top", label: "Top" },
      ],
    },
    { group: "Chrome", region: "rail" },
  ),
  planned(
    "lineHeight",
    "terminal",
    "Line height",
    { kind: "number", value: 1.25, fallback: 1.25, min: 1, max: 2, step: 0.05 },
    { group: "Text", region: "terminal", keywords: ["spacing", "leading"] },
  ),
  planned(
    "cursorStyle",
    "terminal",
    "Cursor",
    {
      kind: "choice",
      value: "bar",
      fallback: "bar",
      choices: [
        { value: "block", label: "Block" },
        { value: "bar", label: "Bar" },
        { value: "underline", label: "Underline" },
      ],
    },
    { group: "Cursor", region: "terminal", keywords: ["caret"] },
  ),
  planned(
    "cursorBlink",
    "terminal",
    "Cursor blink",
    { kind: "switch", value: true, fallback: true },
    { group: "Cursor", region: "terminal", keywords: ["caret", "animation"] },
  ),
  fromRegistry(
    "scrollback",
    { kind: "number", value: 50_000, fallback: 10_000, min: 1_000, max: 100_000, step: 1_000 },
    { group: "History", region: "terminal" },
  ),
  fromRegistry(
    "agentNotifications",
    { kind: "switch", value: true, fallback: false },
    { group: "Alerts", region: "rail" },
  ),
  planned(
    "turnCompleteAlert",
    "notifications",
    "When a turn finishes",
    {
      kind: "choice",
      value: "background",
      fallback: "background",
      choices: [
        { value: "never", label: "Never" },
        { value: "background", label: "In background" },
        { value: "always", label: "Always" },
      ],
    },
    { group: "Alerts", region: "rail", keywords: ["done", "completed"] },
  ),
  planned(
    "needsInputAlert",
    "notifications",
    "When an agent needs you",
    { kind: "switch", value: true, fallback: true },
    { group: "Alerts", region: "rail", keywords: ["permission", "question", "input"] },
  ),
  planned(
    "alertSound",
    "notifications",
    "Sound",
    {
      kind: "choice",
      value: "chime",
      fallback: "chime",
      choices: [
        { value: "off", label: "Off" },
        { value: "chime", label: "Chime" },
        { value: "tick", label: "Tick" },
      ],
    },
    { group: "Sound", keywords: ["audio", "volume"] },
  ),
  fromRegistry(
    "browserHomeUrl",
    { kind: "text", value: "http://localhost:5173", fallback: "http://localhost:3000" },
    { region: "browser" },
  ),
  fromRegistry(
    "externalAppId",
    {
      kind: "choice",
      value: "cursor",
      fallback: "vscode",
      choices: [
        { value: "vscode", label: "Visual Studio Code" },
        { value: "cursor", label: "Cursor" },
        { value: "zed", label: "Zed" },
        { value: "finder", label: "Finder" },
      ],
    },
    { region: "dock" },
  ),
];

export function isChanged(setting: MockSetting): boolean {
  return setting.control.value !== setting.control.fallback;
}
