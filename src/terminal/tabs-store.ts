import { signal } from "@preact/signals";
import type { TabDotColor } from "../lib/tab-colors";
import type { AgentAttentionSummary } from "./agent-attention";

/** Shared with UI consumers so they can import it from tabs-store. */
export type { AgentAttentionSummary } from "./agent-attention";

/** Fallback summary for a `TabView` whose `attention` is not yet populated. */
export const IDLE_ATTENTION_SUMMARY: AgentAttentionSummary = {
  kind: "idle",
  actionableCount: 0,
  workingCount: 0,
  unreadCount: 0,
};

/** What the tab bar needs to render one tab. */
export interface TabView {
  /** Stable identity for list rendering (not a pane/PTY id). */
  readonly key: number;
  /** Foreground process of the tab's active pane — null until the first poll. */
  readonly process: string | null;
  /** Custom name override — null means "derive from process". */
  readonly name: string | null;
  /** Dot color override token — null means "derive from process". */
  readonly dotColor: TabDotColor | null;
  /** Workspace this tab belongs to — null for pre-0.2.2 restored tabs. */
  readonly workspacePath: string | null;
  /** A recognized agent runs in at least one pane of this tab. */
  readonly agentBusy: boolean;
  /** New output arrived in this tab while it was not active; cleared on open. */
  readonly unread: boolean;
  /**
   * Per-tab Agent Attention Rail summary — undefined until the tracker has a
   * value for this tab; consumers fall back to `IDLE_ATTENTION_SUMMARY`.
   */
  readonly attention?: AgentAttentionSummary;
}

/** User overrides for one tab; absent fields fall back to derived values. */
export interface TabOverride {
  readonly name?: string;
  readonly dotColor?: TabDotColor;
}

/**
 * Merge overrides on top of process-derived values. syncViews rebuilds
 * tabViews from the process poll every 2s — running derived values through
 * this is what makes a rename survive polling.
 */
export function applyTabOverride(
  view: TabView,
  override: TabOverride | undefined,
): TabView {
  if (override === undefined) {
    return view;
  }
  return {
    ...view,
    name: override.name ?? view.name,
    dotColor: override.dotColor ?? view.dotColor,
  };
}

/** What the status bar needs. */
export interface StatusInfo {
  readonly branch: string | null;
  readonly cwd: string | null;
  readonly agent: string | null;
  readonly paneCount: number;
  readonly home: string;
}

export const tabViews = signal<readonly TabView[]>([]);
export const activeTabIndex = signal(0);
/**
 * Tab whose rename/dot-color popover a keyboard action (⌘⇧R,
 * `open-tab-options`) wants opened next. Set by TabManager, consumed and
 * reset to `null` by whichever chrome component (TabBar or WorkspaceSidebar)
 * is currently mounted — only one renders at a time (Settings'
 * `tabBarPosition`), so there is exactly one consumer per request.
 */
export const requestTabOptionsKey = signal<number | null>(null);
export const statusInfo = signal<StatusInfo>({
  branch: null,
  cwd: null,
  agent: null,
  paneCount: 1,
  home: "",
});
