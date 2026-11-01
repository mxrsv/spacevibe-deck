import type { AgentKind } from "../../layout-fixture";
import type { AreaId } from "./settings-data";

/** The compound parts of the Settings scenario: agents, shortcuts, app facts and health. */

/** How an agent reports its state to Deck. */
export type SignalSource = "hooks" | "plugin" | "inferred";

export interface MockAgentConfig {
  readonly id: string;
  /** Built-in agents reuse the shell fixture's logos; custom ones have none. */
  readonly kind: AgentKind | "custom";
  readonly name: string;
  readonly command: string;
  readonly installed: boolean;
  readonly version?: string;
  readonly enabled: boolean;
  /** Pinned to quick launch (`quickAgentIds`). */
  readonly pinned: boolean;
  readonly signals: SignalSource;
  /** Whether the signal adapter is switched on (`agentSignalAdapters`); null when none exists. */
  readonly signalsOn: boolean | null;
  readonly model?: string;
  readonly models?: readonly string[];
  readonly effort?: "low" | "medium" | "high";
  /** The default launch profile's name and flags (`defaultLaunchProfiles`, `launchProfiles`). */
  readonly profile?: { readonly name: string; readonly flags: string };
}

export const AGENT_CONFIGS: readonly MockAgentConfig[] = [
  {
    id: "claude",
    kind: "claude",
    name: "Claude Code",
    command: "claude",
    installed: true,
    version: "2.1.281",
    enabled: true,
    pinned: true,
    signals: "hooks",
    signalsOn: true,
    model: "opus",
    models: ["opus", "sonnet", "haiku"],
    effort: "high",
    profile: { name: "Skip permissions", flags: "--dangerously-skip-permissions" },
  },
  {
    id: "codex",
    kind: "codex",
    name: "Codex",
    command: "codex",
    installed: true,
    version: "0.164.0",
    enabled: true,
    pinned: true,
    signals: "hooks",
    signalsOn: true,
    model: "gpt-5.5-codex",
    models: ["gpt-5.5-codex", "gpt-5.5"],
    effort: "medium",
    profile: { name: "Full auto", flags: "--full-auto" },
  },
  {
    id: "opencode",
    kind: "opencode",
    name: "OpenCode",
    command: "opencode",
    installed: true,
    version: "1.18.2",
    enabled: true,
    pinned: false,
    signals: "plugin",
    signalsOn: false,
  },
  {
    id: "gemini",
    kind: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    installed: true,
    version: "0.31.0",
    enabled: true,
    pinned: false,
    signals: "inferred",
    signalsOn: null,
  },
  {
    id: "amp",
    kind: "amp",
    name: "Amp",
    command: "amp",
    installed: true,
    version: "0.9.4",
    enabled: false,
    pinned: false,
    signals: "inferred",
    signalsOn: null,
  },
  {
    id: "droid",
    kind: "droid",
    name: "Droid",
    command: "droid",
    installed: false,
    enabled: true,
    pinned: false,
    signals: "inferred",
    signalsOn: null,
  },
  {
    id: "aider",
    kind: "custom",
    name: "Aider",
    command: "aider --model sonnet --no-auto-commits",
    installed: true,
    enabled: true,
    pinned: false,
    signals: "inferred",
    signalsOn: null,
  },
];

export interface MockShortcut {
  readonly id: string;
  readonly label: string;
  readonly group: "Agents" | "Panes" | "Views" | "App";
  /** Display chord, macOS glyphs. */
  readonly keys: readonly string[];
  /** The default when the user changed it. */
  readonly fallback?: readonly string[];
  /** Another action that claims the same chord. */
  readonly conflictsWith?: string;
}

export const SHORTCUTS: readonly MockShortcut[] = [
  { id: "new-agent", label: "New agent", group: "Agents", keys: ["⌘", "T"] },
  { id: "next-attention", label: "Next agent needing you", group: "Agents", keys: ["⌘", "⇧", "A"] },
  { id: "close-pane", label: "Close pane", group: "Panes", keys: ["⌘", "W"] },
  { id: "split-row", label: "Split right", group: "Panes", keys: ["⌘", "D"] },
  {
    id: "split-column",
    label: "Split down",
    group: "Panes",
    keys: ["⌘", "⇧", "D"],
    conflictsWith: "Toggle dock",
  },
  { id: "zoom-pane", label: "Expand pane", group: "Panes", keys: ["⌘", "⇧", "↵"] },
  {
    id: "toggle-dock",
    label: "Toggle dock",
    group: "Views",
    keys: ["⌘", "⇧", "D"],
    fallback: ["⌘", "⇧", "J"],
    conflictsWith: "Split down",
  },
  { id: "open-diff", label: "Review changes", group: "Views", keys: ["⌘", "⇧", "H"] },
  { id: "toggle-browser", label: "Browser", group: "Views", keys: ["⌘", "⇧", "I"] },
  { id: "token-usage", label: "Token usage", group: "Views", keys: ["⌘", "⇧", "U"] },
  { id: "session-history", label: "Session history", group: "Views", keys: ["⌘", "⇧", "Y"] },
  { id: "settings", label: "Settings", group: "App", keys: ["⌘", ","] },
  { id: "command-palette", label: "Command palette", group: "App", keys: ["⌘", "K"] },
];

export const ABOUT = {
  version: "2.13.0",
  channel: "Stable",
  update: { version: "2.14.0", size: "126 MB" },
} as const;

/** What the always-on analytics collect; there is no opt-out by decision. */
export const ANALYTICS_COLLECTS: readonly string[] = [
  "App version, OS and architecture",
  "Which features open, by name",
  "Which agent kinds launch, not their prompts",
  "Crash reports without file contents",
];

export const RESET_SCOPES: readonly { readonly id: string; readonly label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "agents", label: "Agent configurations" },
  { id: "templates", label: "Prompt templates" },
];

/** Problems in the current setup, loudest first, each with the area that fixes it. */
export interface HealthIssue {
  readonly id: string;
  readonly severity: "error" | "warning" | "info";
  readonly title: string;
  readonly area: AreaId;
  /** The one action that resolves it. */
  readonly action: string;
}

export const HEALTH: readonly HealthIssue[] = [
  {
    id: "notifications-blocked",
    severity: "error",
    title: "macOS blocks Deck's notifications",
    area: "notifications",
    action: "Open System Settings",
  },
  {
    id: "shortcut-conflict",
    severity: "warning",
    title: "⌘⇧D is claimed twice",
    area: "shortcuts",
    action: "Resolve",
  },
  {
    id: "opencode-signals",
    severity: "warning",
    title: "OpenCode reports no state: its plugin is off",
    area: "agents",
    action: "Turn on",
  },
  {
    id: "update",
    severity: "info",
    title: "Deck 2.14.0 is ready",
    area: "about",
    action: "Restart to update",
  },
  {
    id: "droid-missing",
    severity: "info",
    title: "Droid is not installed",
    area: "agents",
    action: "Install",
  },
];

/** The OS permission behind `agentNotifications`; Deck asks once, then only the OS can change it. */
export const NOTIFICATION_PERMISSION: "granted" | "denied" | "not-asked" = "denied";
