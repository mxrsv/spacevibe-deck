import { isEditorId, type EditorId } from "../lib/editor-command";
import {
  agentBinary,
  AGENT_LABEL_MAX,
  CUSTOM_ID_PREFIX,
  isProbeSafeName,
  type CustomAgent,
} from "../lib/agent-catalog";
import { isValidPromptTemplate, type PromptTemplate } from "../prompts/prompt-templates";
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

/**
 * Which xterm renderer paints a pane. A genuine trade, which is why it is a
 * setting rather than a constant: `dom` lets the browser lay out text, so it
 * keeps subpixel antialiasing and subpixel advance widths, but it cannot draw
 * custom glyphs — block and box-drawing characters come out of the font and
 * TUIs that join them across cells (OpenCode's wordmark, prompt borders) look
 * segmented. `webgl` draws those glyphs to the full cell box, at the cost of
 * routing all text through a texture atlas: grayscale antialiasing, and cell
 * widths rounded to whole device pixels.
 *
 * No `canvas` value on purpose — `TextureAtlas` lives in xterm core and both
 * accelerated addons share it, so canvas would carry webgl's text trade
 * without its speed.
 */
export type TerminalRenderer = "dom" | "webgl";

export const TERMINAL_RENDERERS: readonly TerminalRenderer[] = Object.freeze(["dom", "webgl"]);

/**
 * The docked right column's tabs. Declared here rather than in the dock's own
 * registry because this is a PERSISTED value: the schema is what a stored
 * profile is validated against, and a UI module owning the union would make
 * the storage contract depend on a render layer.
 */
export type DockTab = "explorer" | "usage" | "sessions";

export const DOCK_TABS: readonly DockTab[] = Object.freeze(["explorer", "usage", "sessions"]);

export interface Settings {
  fontFamily: string;
  fontSize: number;
  themeId: string;
  colorOverrides: Partial<TerminalColors>;
  focusExpand: boolean;
  showPaneBar: boolean;
  /**
   * The window's bottom status row. Off since 2026-08-16: the row is pure
   * readout, and the owner asked for the height back. The setting exists
   * so the choice stays the user's rather than being deleted for them.
   */
  showStatusBar: boolean;
  agentNotifications: boolean;
  tabBarPosition: TabBarPosition;
  /**
   * Width of the navigation sidebar column, in CSS pixels (DL-18.9). Only
   * `tabBarPosition: "left"` renders that column; the value is kept either way
   * so flipping the layout back restores the width the user set.
   */
  sidebarWidth: number;
  /**
   * Whether that column is collapsed to its icon rail (DL-18.9). Collapsed is
   * NOT hidden: the frame row lives inside this column on macOS (DL-18.3), so
   * the traffic lights and the toolbar keep a column to sit in.
   */
  sidebarCollapsed: boolean;
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
  /**
   * Address the browser panel opens on when nothing is loaded yet. A dev
   * server's port is the one thing every project has and no two share, so it
   * is a setting rather than a constant.
   */
  browserHomeUrl: string;
  /**
   * The page the panel restores on a cold open — the last committed
   * main-frame navigation, written by the host's `browser:navigated` event.
   * One value app-wide, last writer wins across windows (browser
   * productization §3); empty until the panel has ever navigated.
   */
  browserLastUrl: string;
  /**
   * Whether the docked right column is shown. It was `explorerOpen` while the
   * file tree was the column's only occupant; the column now hosts several
   * surfaces as tabs, so the flag is about the dock, not about one tab of it.
   */
  dockOpen: boolean;
  /** Width of the docked right column, in CSS pixels. */
  dockWidth: number;
  /** Which tab the dock shows. Restored on open; falls back when unavailable. */
  dockTab: DockTab;
  /**
   * Chords the user rebound, per platform, over the shipped keymaps. Keyed by
   * platform rather than flat because the two keymaps are genuinely different
   * documents — the same action has different chords on each, and a single map
   * would make one machine's rebind silently rewrite the other's.
   */
  keybindings: KeybindingOverrides;
  /** Reopen last session's tabs and resume agent conversations at launch. */
  restoreSessions: boolean;
  /**
   * Which renderer paints terminal panes. Defaults to `dom` — the renderer
   * every shipped build has used — so the accelerated path is opt-in and no
   * existing profile has its text rendering changed underneath it.
   */
  terminalRenderer: TerminalRenderer;
}

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

export const SCROLLBACK_MIN = 1000;
export const SCROLLBACK_MAX = 100_000;
export const SCROLLBACK_CHOICES = [1000, 5000, 10_000, 50_000, 100_000] as const;

export const FONT_FALLBACK = "Menlo, Monaco, monospace";

export const COLOR_KEYS = ["background", "foreground", "cursor", "selectionBackground"] as const;

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: "SF Mono",
  fontSize: 13,
  themeId: "tokyo-night",
  colorOverrides: {},
  focusExpand: false,
  showPaneBar: false,
  showStatusBar: false,
  agentNotifications: false,
  tabBarPosition: "left",
  sidebarWidth: 275,
  sidebarCollapsed: false,
  editorId: "vscode",
  editorCommand: "",
  scrollback: 10_000,
  customAgents: [],
  promptTemplates: [],
  browserHomeUrl: "http://localhost:3000",
  browserLastUrl: "",
  dockOpen: false,
  dockWidth: 420,
  dockTab: "explorer",
  keybindings: NO_KEYBINDING_OVERRIDES,
  restoreSessions: true,
  terminalRenderer: "dom",
};

export const BROWSER_WIDTH_MIN = 280;
export const BROWSER_WIDTH_MAX = 900;

export function clampBrowserWidth(width: number): number {
  return Math.min(BROWSER_WIDTH_MAX, Math.max(BROWSER_WIDTH_MIN, Math.round(width)));
}

// Wider than the file tree's old range (180–480, default 260), and
// deliberately so: the column stopped being a file tree when it became the
// dock. Its narrowest tab is still the tree, but its widest is the usage
// dashboard's data tables (DL §15), and 360 is the floor those were built to
// survive. The consequence is stated rather than hidden — a user who kept a
// 180px file tree cannot have one any more; one column serving three surfaces
// takes its floor from the widest of them.
export const DOCK_WIDTH_MIN = 360;
export const DOCK_WIDTH_MAX = 720;

// The navigation sidebar's own range (DL-18.9). The floor is 200, below the
// 275px default that `styles.css` still explains as a drag-affordance figure:
// at 275 the frame row had ~100px of grabbable titlebar left after the traffic
// lights and the actions, and a narrower column eats into that. What changed
// is that the stage now carries its own drag region (`.stage__strip`), so a
// user who chooses a narrow rail still has a titlebar to grab — on the other
// side of the seam. Anything below the floor is not a narrower rail, it is the
// collapse gesture (see `PANEL_COLLAPSE_SLACK`).
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 420;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)));
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const TAB_BAR_POSITIONS: readonly TabBarPosition[] = ["top", "left"];

function isTabBarPosition(value: unknown): value is TabBarPosition {
  return TAB_BAR_POSITIONS.includes(value as TabBarPosition);
}

function isTerminalRenderer(value: unknown): value is TerminalRenderer {
  return TERMINAL_RENDERERS.includes(value as TerminalRenderer);
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
  return typeof agent.command === "string" && isProbeSafeName(agentBinary(agent.command));
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
    themeId: typeof source.themeId === "string" ? source.themeId : DEFAULT_SETTINGS.themeId,
    colorOverrides: validateColorOverrides(source.colorOverrides),
    focusExpand:
      typeof source.focusExpand === "boolean" ? source.focusExpand : DEFAULT_SETTINGS.focusExpand,
    showStatusBar:
      typeof source.showStatusBar === "boolean"
        ? source.showStatusBar
        : DEFAULT_SETTINGS.showStatusBar,
    showPaneBar:
      typeof source.showPaneBar === "boolean" ? source.showPaneBar : DEFAULT_SETTINGS.showPaneBar,
    agentNotifications:
      typeof source.agentNotifications === "boolean"
        ? source.agentNotifications
        : DEFAULT_SETTINGS.agentNotifications,
    tabBarPosition: isTabBarPosition(source.tabBarPosition)
      ? source.tabBarPosition
      : DEFAULT_SETTINGS.tabBarPosition,
    sidebarWidth:
      typeof source.sidebarWidth === "number" && Number.isFinite(source.sidebarWidth)
        ? clampSidebarWidth(source.sidebarWidth)
        : DEFAULT_SETTINGS.sidebarWidth,
    sidebarCollapsed:
      typeof source.sidebarCollapsed === "boolean"
        ? source.sidebarCollapsed
        : DEFAULT_SETTINGS.sidebarCollapsed,
    editorId: isEditorId(source.editorId) ? source.editorId : DEFAULT_SETTINGS.editorId,
    editorCommand:
      typeof source.editorCommand === "string"
        ? source.editorCommand
        : DEFAULT_SETTINGS.editorCommand,
    scrollback:
      typeof source.scrollback === "number" && Number.isFinite(source.scrollback)
        ? clampScrollback(source.scrollback)
        : DEFAULT_SETTINGS.scrollback,
    customAgents: validateCustomAgents(source.customAgents),
    promptTemplates: validatePromptTemplates(source.promptTemplates),
    // Not normalized to a URL here: the host is the one that decides what is
    // loadable, and a value this validator "fixed" would disagree with it.
    // An unusable address opens a blank panel, which is visible and editable.
    browserHomeUrl:
      typeof source.browserHomeUrl === "string" && source.browserHomeUrl.length <= 2048
        ? source.browserHomeUrl
        : DEFAULT_SETTINGS.browserHomeUrl,
    // Same posture as browserHomeUrl: the host's own URL gate decides what is
    // loadable at open time, and a malformed stored value degrades to a blank
    // panel there rather than being "fixed" into a disagreement here.
    browserLastUrl:
      typeof source.browserLastUrl === "string" && source.browserLastUrl.length <= 2048
        ? source.browserLastUrl
        : DEFAULT_SETTINGS.browserLastUrl,
    dockOpen: typeof source.dockOpen === "boolean" ? source.dockOpen : DEFAULT_SETTINGS.dockOpen,
    dockWidth:
      typeof source.dockWidth === "number" && Number.isFinite(source.dockWidth)
        ? clampDockWidth(source.dockWidth)
        : DEFAULT_SETTINGS.dockWidth,
    // An unknown tab id resolves to the default rather than being kept: this
    // value names a surface, and a name nothing answers to would leave the
    // dock rendering an empty column.
    dockTab: DOCK_TABS.includes(source.dockTab as DockTab)
      ? (source.dockTab as DockTab)
      : DEFAULT_SETTINGS.dockTab,
    keybindings: validateKeybindings(source.keybindings),
    restoreSessions:
      typeof source.restoreSessions === "boolean"
        ? source.restoreSessions
        : DEFAULT_SETTINGS.restoreSessions,
    // An unknown renderer name falls back rather than being kept: this value
    // selects a code path, and a name nothing answers to would leave panes
    // with no renderer resolved at all.
    terminalRenderer: isTerminalRenderer(source.terminalRenderer)
      ? source.terminalRenderer
      : DEFAULT_SETTINGS.terminalRenderer,
  };
}
