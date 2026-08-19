import {
  EXTERNAL_APPS,
  isExternalAppId,
  type ExternalAppId,
} from "../lib/external-app-catalog";
import {
  agentBinary,
  AGENT_LABEL_MAX,
  CUSTOM_ID_PREFIX,
  isProbeSafeName,
  type CustomAgent,
} from "../lib/agent-catalog";
import {
  validateDefaultLaunchProfiles,
  validateLaunchProfiles,
  type LaunchProfile,
} from "../lib/launch-profile";
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

/**
 * The docked right column's tabs. Declared here rather than in the dock's own
 * registry because this is a PERSISTED value: the schema is what a stored
 * profile is validated against, and a UI module owning the union would make
 * the storage contract depend on a render layer.
 */
export type DockTab = "explorer" | "usage" | "sessions";

export const DOCK_TABS: readonly DockTab[] = Object.freeze([
  "explorer",
  "usage",
  "sessions",
]);

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
  /**
   * The app a path OUTSIDE every open workspace is handed to (design §5).
   *
   * One field where `editorId` + `editorCommand` used to be two. A path that
   * belongs to a workspace this window has open never reaches it — that always
   * opens in Deck's own editor, with no switch — so this is the fallback, not
   * a preference about editors. Both the toolbar's split-button and Settings
   * write it, which is what keeps the chrome and Settings from disagreeing.
   */
  externalAppId: ExternalAppId;
  /** Lines of scrollback kept per pane. */
  scrollback: number;
  /** Agent CLIs the user declared, beyond the built-in set. */
  customAgents: readonly CustomAgent[];
  /** Launch commands the user wrote, replacing the catalog's recommendation. */
  launchProfiles: readonly LaunchProfile[];
  /**
   * Agent ids the user switched off. A built-in cannot be deleted — the probe
   * would find it again on the next scan — so this is the one thing that takes
   * an agent out of the pickers.
   */
  disabledAgents: readonly string[];
  /**
   * The agent a new tab opens with when nothing else names one. Null = fall
   * back to the first detected agent, which is what Deck did before this
   * setting existed.
   */
  defaultAgent: string | null;
  /**
   * Agent id → profile id used when nothing picks one: the Open board, a rail
   * drop, and the quick picker's initial selection. Absent = launch bare.
   */
  defaultLaunchProfiles: Readonly<Record<string, string>>;
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
   * True once Deck has stopped asking for a GitHub star — either the star was
   * made through `gh`, or the user was sent to the repository page and the ask
   * is spent. It is a REMEMBERED ANSWER, not a fact about GitHub: a `gh`-backed
   * recheck may clear it again when the account is no longer starring, which is
   * what makes an unstar reappear as an ask rather than being invisible.
   */
  githubStarred: boolean;
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
  // A NEW install only. Written as a literal rather than imported from
  // `themes.ts` on purpose — that module imports this one for the `Settings`
  // type, and closing the loop would make the schema depend on the palette
  // data it is supposed to validate independently. Every stored id, including
  // the four upstream palettes and any imported file, still validates.
  themeId: "deck-dark",
  colorOverrides: {},
  focusExpand: false,
  showPaneBar: false,
  showStatusBar: false,
  agentNotifications: false,
  tabBarPosition: "left",
  sidebarWidth: 275,
  sidebarCollapsed: false,
  externalAppId: EXTERNAL_APPS[0].id,
  scrollback: 10_000,
  customAgents: [],
  launchProfiles: [],
  disabledAgents: [],
  defaultAgent: null,
  defaultLaunchProfiles: {},
  promptTemplates: [],
  browserHomeUrl: "http://localhost:3000",
  browserLastUrl: "",
  dockOpen: false,
  dockWidth: 420,
  dockTab: "explorer",
  keybindings: NO_KEYBINDING_OVERRIDES,
  restoreSessions: true,
  githubStarred: false,
};

export const BROWSER_WIDTH_MIN = 280;
export const BROWSER_WIDTH_MAX = 900;

export function clampBrowserWidth(width: number): number {
  return Math.min(
    BROWSER_WIDTH_MAX,
    Math.max(BROWSER_WIDTH_MIN, Math.round(width)),
  );
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
  return Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)),
  );
}

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)));
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

/**
 * `externalAppId`, migrating the `editorId`/`editorCommand` pair it replaced
 * (design §5).
 *
 * `vscode`, `cursor` and `zed` are the same app in the new catalog, so those
 * profiles carry over untouched. A stored `custom` has no catalog equivalent
 * and lands on the catalog's first app — **the custom editor command stops
 * being reachable**, which is a real loss and is recorded in `AGENTS.md`'s
 * drift table rather than hidden here. Reading the legacy keys at all is what
 * makes the change invisible to everyone who never used `custom`; dropping
 * them would silently reset every install to VS Code.
 */
function migrateExternalAppId(source: Record<string, unknown>): ExternalAppId {
  if (isExternalAppId(source.externalAppId)) {
    return source.externalAppId;
  }
  const legacy = source.editorId;
  return isExternalAppId(legacy) ? legacy : DEFAULT_SETTINGS.externalAppId;
}

/** Validate data read from the store — invalid fields fall back to defaults. */
export function validateSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const source = raw as Record<string, unknown>;
  // Validated before the return object because the defaults map is checked
  // AGAINST the surviving profiles: a mapping onto a profile that was just
  // dropped has to go with it.
  const validatedLaunchProfiles = validateLaunchProfiles(source.launchProfiles);
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
    showStatusBar:
      typeof source.showStatusBar === "boolean"
        ? source.showStatusBar
        : DEFAULT_SETTINGS.showStatusBar,
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
    sidebarWidth:
      typeof source.sidebarWidth === "number" &&
      Number.isFinite(source.sidebarWidth)
        ? clampSidebarWidth(source.sidebarWidth)
        : DEFAULT_SETTINGS.sidebarWidth,
    sidebarCollapsed:
      typeof source.sidebarCollapsed === "boolean"
        ? source.sidebarCollapsed
        : DEFAULT_SETTINGS.sidebarCollapsed,
    externalAppId: migrateExternalAppId(source),
    scrollback:
      typeof source.scrollback === "number" &&
      Number.isFinite(source.scrollback)
        ? clampScrollback(source.scrollback)
        : DEFAULT_SETTINGS.scrollback,
    customAgents: validateCustomAgents(source.customAgents),
    launchProfiles: validatedLaunchProfiles,
    disabledAgents: Array.isArray(source.disabledAgents)
      ? source.disabledAgents.filter(
          (id): id is string => typeof id === "string",
        )
      : DEFAULT_SETTINGS.disabledAgents,
    // Not checked against the catalog: an id here may belong to an agent the
    // user has since uninstalled, and forgetting the preference because a
    // binary is temporarily missing would be worse than carrying it.
    defaultAgent:
      typeof source.defaultAgent === "string" ? source.defaultAgent : null,
    defaultLaunchProfiles: validateDefaultLaunchProfiles(
      source.defaultLaunchProfiles,
      validatedLaunchProfiles,
    ),
    promptTemplates: validatePromptTemplates(source.promptTemplates),
    // Not normalized to a URL here: the host is the one that decides what is
    // loadable, and a value this validator "fixed" would disagree with it.
    // An unusable address opens a blank panel, which is visible and editable.
    browserHomeUrl:
      typeof source.browserHomeUrl === "string" &&
      source.browserHomeUrl.length <= 2048
        ? source.browserHomeUrl
        : DEFAULT_SETTINGS.browserHomeUrl,
    // Same posture as browserHomeUrl: the host's own URL gate decides what is
    // loadable at open time, and a malformed stored value degrades to a blank
    // panel there rather than being "fixed" into a disagreement here.
    browserLastUrl:
      typeof source.browserLastUrl === "string" &&
      source.browserLastUrl.length <= 2048
        ? source.browserLastUrl
        : DEFAULT_SETTINGS.browserLastUrl,
    dockOpen:
      typeof source.dockOpen === "boolean"
        ? source.dockOpen
        : DEFAULT_SETTINGS.dockOpen,
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
    githubStarred:
      typeof source.githubStarred === "boolean"
        ? source.githubStarred
        : DEFAULT_SETTINGS.githubStarred,
  };
}
