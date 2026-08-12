import { isEditorId, type EditorId } from "../lib/editor-command";
import {
  agentBinary,
  AGENT_LABEL_MAX,
  CUSTOM_ID_PREFIX,
  isProbeSafeName,
  type CustomAgent,
} from "../lib/agent-catalog";
import {
  isValidPromptTemplate,
  type PromptTemplate,
} from "../prompts/prompt-templates";
import {
  NO_KEYBINDING_OVERRIDES,
  validateKeybindings,
  type KeybindingOverrides,
} from "../lib/keybindings";

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
  /** Agent CLIs the user declared, beyond the built-in set. */
  customAgents: readonly CustomAgent[];
  /** Reusable prompt bodies the user declared for the Prompt Board. */
  promptTemplates: readonly PromptTemplate[];
  /** Width of the docked browser column, in CSS pixels. */
  browserWidth: number;
  /**
   * Address the browser panel opens on when nothing is loaded yet. A dev
   * server's port is the one thing every project has and no two share, so it
   * is a setting rather than a constant.
   */
  browserHomeUrl: string;
  /**
   * Chords the user rebound, per platform, over the shipped keymaps. Keyed by
   * platform rather than flat because the two keymaps are genuinely different
   * documents — the same action has different chords on each, and a single map
   * would make one machine's rebind silently rewrite the other's.
   */
  keybindings: KeybindingOverrides;
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
  customAgents: [],
  promptTemplates: [],
  browserWidth: 420,
  browserHomeUrl: "http://localhost:3000",
  keybindings: NO_KEYBINDING_OVERRIDES,
};

export const BROWSER_WIDTH_MIN = 280;
export const BROWSER_WIDTH_MAX = 900;

export function clampBrowserWidth(width: number): number {
  return Math.min(
    BROWSER_WIDTH_MAX,
    Math.max(BROWSER_WIDTH_MIN, Math.round(width)),
  );
}

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

/**
 * Whether one declared agent is well-formed. Shared with the settings UI so
 * that what the form accepts and what survives a reload cannot drift apart.
 * The binary check is the security-relevant one: it is what the discovery
 * probe interpolates into a shell.
 */
export function isValidCustomAgent(value: unknown): value is CustomAgent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const agent = value as Record<string, unknown>;
  if (
    typeof agent.id !== "string" ||
    !agent.id.startsWith(CUSTOM_ID_PREFIX) ||
    agent.id.length <= CUSTOM_ID_PREFIX.length
  ) {
    return false;
  }
  if (
    typeof agent.label !== "string" ||
    agent.label.trim() === "" ||
    agent.label.length > AGENT_LABEL_MAX
  ) {
    return false;
  }
  return (
    typeof agent.command === "string" &&
    isProbeSafeName(agentBinary(agent.command))
  );
}

/**
 * A malformed entry is dropped rather than repaired — a half-understood
 * command is exactly the thing not to guess at, since it ends up typed into a
 * shell. A malformed array falls back to none declared.
 */
function validateCustomAgents(raw: unknown): readonly CustomAgent[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_SETTINGS.customAgents;
  }
  const seen = new Set<string>();
  const result: CustomAgent[] = [];
  for (const entry of raw) {
    if (!isValidCustomAgent(entry) || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    result.push({
      id: entry.id,
      label: entry.label,
      command: entry.command,
    });
  }
  return result;
}

/**
 * Same drop-not-repair discipline as `validateCustomAgents` above, for the
 * same reason: a half-understood template is not guessed at, because its body
 * gets pasted verbatim into a live agent session. A malformed array falls back
 * to none declared, and a duplicate id is dropped (the first wins) so the
 * popover's row keys stay unique.
 */
function validatePromptTemplates(raw: unknown): readonly PromptTemplate[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_SETTINGS.promptTemplates;
  }
  const seen = new Set<string>();
  const result: PromptTemplate[] = [];
  for (const entry of raw) {
    if (!isValidPromptTemplate(entry) || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    result.push({
      id: entry.id,
      label: entry.label,
      body: entry.body,
      autoSend: entry.autoSend,
    });
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
    customAgents: validateCustomAgents(source.customAgents),
    promptTemplates: validatePromptTemplates(source.promptTemplates),
    browserWidth:
      typeof source.browserWidth === "number" &&
      Number.isFinite(source.browserWidth)
        ? clampBrowserWidth(source.browserWidth)
        : DEFAULT_SETTINGS.browserWidth,
    // Not normalized to a URL here: the host is the one that decides what is
    // loadable, and a value this validator "fixed" would disagree with it.
    // An unusable address opens a blank panel, which is visible and editable.
    browserHomeUrl:
      typeof source.browserHomeUrl === "string" && source.browserHomeUrl.length <= 2048
        ? source.browserHomeUrl
        : DEFAULT_SETTINGS.browserHomeUrl,
    keybindings: validateKeybindings(source.keybindings),
  };
}
