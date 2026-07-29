import { isEditorId, type EditorId } from "../lib/editor-command";

export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
}

/** `left` = workspace sidebar (default), `top` = the classic horizontal bar. */
export type TabBarPosition = "top" | "left";

export interface Settings {
  fontFamily: string;
  fontSize: number;
  themeId: string;
  colorOverrides: Partial<TerminalColors>;
  focusExpand: boolean;
  showPaneBar: boolean;
  agentNotifications: boolean;
  tabBarPosition: TabBarPosition;
  /** Editor launched through the platform link-activation gesture. */
  editorId: EditorId;
  /** Command template used when `editorId` is `custom` (empty until set). */
  editorCommand: string;
  /** Lines of scrollback kept per pane. */
  scrollback: number;
}

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

export const SCROLLBACK_MIN = 1000;
export const SCROLLBACK_MAX = 100_000;
export const SCROLLBACK_CHOICES = [
  1000, 5000, 10_000, 50_000, 100_000,
] as const;

export const FONT_FALLBACK = "Menlo, Monaco, monospace";

export const COLOR_KEYS = [
  "background",
  "foreground",
  "cursor",
  "selectionBackground",
] as const;

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: "SF Mono",
  fontSize: 13,
  themeId: "tokyo-night",
  colorOverrides: {},
  focusExpand: false,
  showPaneBar: false,
  agentNotifications: false,
  tabBarPosition: "left",
  editorId: "vscode",
  editorCommand: "",
  scrollback: 10_000,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const TAB_BAR_POSITIONS: readonly TabBarPosition[] = ["top", "left"];

function isTabBarPosition(value: unknown): value is TabBarPosition {
  return TAB_BAR_POSITIONS.includes(value as TabBarPosition);
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function clampFontSize(size: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

export function clampScrollback(n: number): number {
  return Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, Math.round(n)));
}

function validateColorOverrides(raw: unknown): Partial<TerminalColors> {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const result: Partial<TerminalColors> = {};
  for (const key of COLOR_KEYS) {
    const value = source[key];
    if (isHexColor(value)) {
      result[key] = value;
    }
  }
  return result;
}

/** Validate data read from the store — invalid fields fall back to defaults. */
export function validateSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const source = raw as Record<string, unknown>;
  return {
    fontFamily:
      typeof source.fontFamily === "string" && source.fontFamily.trim() !== ""
        ? source.fontFamily
        : DEFAULT_SETTINGS.fontFamily,
    fontSize:
      typeof source.fontSize === "number" && Number.isFinite(source.fontSize)
        ? clampFontSize(source.fontSize)
        : DEFAULT_SETTINGS.fontSize,
    themeId:
      typeof source.themeId === "string"
        ? source.themeId
        : DEFAULT_SETTINGS.themeId,
    colorOverrides: validateColorOverrides(source.colorOverrides),
    focusExpand:
      typeof source.focusExpand === "boolean"
        ? source.focusExpand
        : DEFAULT_SETTINGS.focusExpand,
    showPaneBar:
      typeof source.showPaneBar === "boolean"
        ? source.showPaneBar
        : DEFAULT_SETTINGS.showPaneBar,
    agentNotifications:
      typeof source.agentNotifications === "boolean"
        ? source.agentNotifications
        : DEFAULT_SETTINGS.agentNotifications,
    tabBarPosition: isTabBarPosition(source.tabBarPosition)
      ? source.tabBarPosition
      : DEFAULT_SETTINGS.tabBarPosition,
    editorId: isEditorId(source.editorId)
      ? source.editorId
      : DEFAULT_SETTINGS.editorId,
    editorCommand:
      typeof source.editorCommand === "string"
        ? source.editorCommand
        : DEFAULT_SETTINGS.editorCommand,
    scrollback:
      typeof source.scrollback === "number" &&
      Number.isFinite(source.scrollback)
        ? clampScrollback(source.scrollback)
        : DEFAULT_SETTINGS.scrollback,
  };
}
