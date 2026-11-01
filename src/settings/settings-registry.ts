import type { Settings } from "./settings-schema";

/** The rail pages a setting can live on; a test keeps every one of them a rail category. */
export const SETTINGS_PAGES = [
  "appearance",
  "browser",
  "terminal",
  "agents",
  "links-editor",
  "shortcuts",
  "notifications",
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/**
 * `preference` is something the user chose in Settings, `layout` is window
 * chrome the app also writes while it is used (widths, open flags), `data` is
 * content the user wrote (agents, prompts), and `state` is what the app
 * remembers on its own (last page, answered asks). Reset rows act on the
 * first three and never touch `state` (FBK-3).
 */
export type SettingScope = "preference" | "layout" | "data" | "state";

export interface SettingEntry {
  /**
   * The page whose rows edit the key; null when no Settings row does. A test
   * walks every page and fails when a row's `data-setting` and this field
   * disagree, so a key never claims a page that does not show it.
   */
  readonly page: SettingsPage | null;
  readonly scope: SettingScope;
  /**
   * The text the user reads on the row (or group title). Rows with a
   * `settingKey` take it from here, so search, the reset prompt and the row
   * cannot name one setting two ways.
   */
  readonly label: string;
  /** Extra words search matches besides the label. */
  readonly keywords: readonly string[];
}

/**
 * One entry per `Settings` key (SET-1). Typed as a full `Record`, so adding a
 * key to the schema without describing it here — or leaving a stale entry
 * behind — fails `tsc`; search, change marks and page reset read this table.
 */
export const SETTINGS_REGISTRY: Readonly<Record<keyof Settings, SettingEntry>> = {
  fontFamily: {
    page: "appearance",
    scope: "preference",
    label: "Font",
    keywords: ["typeface", "mono", "family"],
  },
  fontSize: {
    page: "appearance",
    scope: "preference",
    label: "Font size",
    keywords: ["text", "zoom"],
  },
  themeId: {
    page: "appearance",
    scope: "preference",
    label: "Color mode",
    keywords: ["theme", "dark", "light", "palette"],
  },
  focusExpand: { page: null, scope: "layout", label: "Expand focused pane", keywords: [] },
  showPaneBar: {
    page: "appearance",
    scope: "preference",
    label: "Show pane bar",
    keywords: ["header"],
  },
  showStatusBar: {
    page: "appearance",
    scope: "preference",
    label: "Show status bar",
    keywords: ["footer"],
  },
  agentNotifications: {
    page: "notifications",
    scope: "preference",
    label: "Agent notifications",
    keywords: ["alert", "attention"],
  },
  agentNotificationsDefaultOn: {
    page: null,
    scope: "data",
    label: "Notification default migration",
    keywords: [],
  },
  tabBarPosition: {
    page: "appearance",
    scope: "preference",
    label: "Tab bar position",
    keywords: ["sidebar", "layout"],
  },
  sidebarWidth: { page: null, scope: "layout", label: "Sidebar width", keywords: [] },
  sidebarCollapsed: { page: null, scope: "layout", label: "Sidebar collapsed", keywords: [] },
  externalAppId: {
    page: "links-editor",
    scope: "preference",
    label: "Open with",
    keywords: ["editor", "app", "link", "outside paths"],
  },
  scrollback: {
    page: "terminal",
    scope: "preference",
    label: "Scrollback",
    keywords: ["history", "lines"],
  },
  customAgents: {
    page: "agents",
    scope: "data",
    label: "Custom agents",
    keywords: ["command", "cli"],
  },
  launchProfiles: {
    page: "agents",
    scope: "data",
    label: "Launch profiles",
    keywords: ["flags", "arguments"],
  },
  disabledAgents: {
    page: "agents",
    scope: "preference",
    label: "Disabled agents",
    keywords: ["hide", "switch off"],
  },
  quickAgentIds: {
    page: "agents",
    scope: "preference",
    label: "Pinned agents",
    keywords: ["quick launch"],
  },
  railOrder: { page: null, scope: "layout", label: "Project order", keywords: [] },
  defaultAgent: {
    page: null,
    scope: "preference",
    label: "Default agent",
    keywords: ["new tab"],
  },
  defaultLaunchProfiles: {
    page: "agents",
    scope: "preference",
    label: "Default launch profile",
    keywords: ["flags"],
  },
  agentModels: { page: "agents", scope: "data", label: "Agent models", keywords: ["model list"] },
  agentRuntimeDefaults: {
    page: "agents",
    scope: "preference",
    label: "Agent model and effort",
    keywords: ["reasoning", "model"],
  },
  agentSignalAdapters: {
    page: "agents",
    scope: "preference",
    label: "Signal adapters",
    keywords: ["hooks", "status"],
  },
  signalAdaptersRevision: {
    page: null,
    scope: "state",
    label: "Signal adapters revision",
    keywords: [],
  },
  quickLaunchPromptExpanded: {
    page: null,
    scope: "layout",
    label: "Quick launch prompt expanded",
    keywords: [],
  },
  promptTemplates: { page: null, scope: "data", label: "Prompt templates", keywords: [] },
  browserHomeUrl: {
    page: "browser",
    scope: "preference",
    label: "Home address",
    keywords: ["browser", "home page", "url", "localhost", "port"],
  },
  browserLastUrl: { page: null, scope: "state", label: "Last browser page", keywords: [] },
  dockOpen: { page: null, scope: "layout", label: "Dock open", keywords: [] },
  dockWidth: { page: null, scope: "layout", label: "Dock width", keywords: [] },
  dockTab: { page: null, scope: "layout", label: "Dock tab", keywords: [] },
  keybindings: {
    page: "shortcuts",
    scope: "preference",
    label: "Keyboard shortcuts",
    keywords: ["keys", "chord", "hotkey"],
  },
  githubStarred: { page: null, scope: "state", label: "GitHub star asked", keywords: [] },
};
