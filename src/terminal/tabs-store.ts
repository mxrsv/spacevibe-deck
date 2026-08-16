import { signal } from "@preact/signals";
import type { PaneAgent } from "../lib/process-info";
import type { TabDotColor } from "../lib/tab-colors";
import type { AgentPhase } from "./agent-activity";
import type { AgentAttentionSummary, AttentionKind } from "./agent-attention";

/** Shared with UI consumers so they can import it from tabs-store. */
export type { AgentAttentionSummary } from "./agent-attention";

/**
 * One pane of a tab, as the chrome sees it.
 *
 * The tracker has always known each pane's state; until 2026-08-16 the
 * renderer only ever received the per-tab ROLLUP, so no surface could name the
 * pane behind a mark. The agent rail's chips and its expanded per-agent rows
 * both activate an exact pane
 * (`docs/specs/2026-08-16-agent-status-rail-design.md` §2.2), and activating
 * one needs its id — which is why this projection is published with `tabViews`
 * rather than derived later from something coarser.
 *
 * Every pane appears here, agent or not: a shell pane is not a rail row (spec
 * §9) but it is still part of the tab, and the filter belongs to the surface
 * that renders rows, not to the projection that reports facts.
 */
export interface PaneView {
  /** PTY/pane id — the coordinate `TabManager.activateForAttention` takes. */
  readonly paneId: number;
  /** Recognized agent in this pane, or null for a shell/unrecognized process. */
  readonly agent: PaneAgent | null;
  /** Latched attention, straight from the tracker snapshot. */
  readonly attention: AttentionKind;
  /** Live work signal, straight from the tracker snapshot. */
  readonly phase: AgentPhase;
  /** When the pane's visible state last changed; 0 before the first change. */
  readonly changedAt: number;
}

/** `TabView.panes` before the first sync — a shared empty list, not a new one. */
export const NO_PANES: readonly PaneView[] = Object.freeze([]);

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
  /** Recognized agents currently present across this tab's panes, busy or idle. */
  readonly agents: readonly PaneAgent[];
  /** A recognized agent runs in at least one pane of this tab. */
  readonly agentBusy: boolean;
  /** New output arrived in this tab while it was not active; cleared on open. */
  readonly unread: boolean;
  /**
   * Per-tab Agent Attention Rail summary — undefined until the tracker has a
   * value for this tab; consumers fall back to `IDLE_ATTENTION_SUMMARY`.
   */
  readonly attention?: AgentAttentionSummary;
  /**
   * This tab's panes, in layout order. Optional for the same reason
   * `attention` is: a `TabView` built by a test or a seed fixture predates
   * this field, and consumers fall back to `NO_PANES`.
   */
  readonly panes?: readonly PaneView[];
  /**
   * Where this tab sits in the strip's one open order
   * ([`open-sequence.ts`](../lib/open-sequence.ts)), shared with file tabs and
   * the browser chip since 2026-08-16 (DL-18.6).
   *
   * Optional on the same grounds as `panes`: a fixture-built `TabView` has no
   * key, and `UNSEQUENCED` sorts it before every real one — which reproduces
   * the terminals-then-surfaces strip those fixtures were written against.
   */
  readonly openedAt?: number;
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
  /**
   * Panes in the active tab, or **null when a non-terminal surface is active**.
   *
   * Null, not zero: spec §7 asks for the count to be ABSENT with a file tab
   * active, not "0 panes" — a label that reads as a broken window rather than
   * as a different kind of surface. `StatusBar` branches on it.
   */
  readonly paneCount: number | null;
  readonly home: string;
}

export const tabViews = signal<readonly TabView[]>([]);
export const activeTabIndex = signal(0);
/**
 * Tab whose rename/dot-color popover a keyboard action (⌘⇧R,
 * `open-tab-options`) wants opened next. Set by TabManager, consumed and reset
 * to `null` by the chrome component that owns the chord in the current layout.
 *
 * "Whichever component is mounted" was the rule until 2026-08-14, when it
 * stopped being enough: sidebar layout mounts `RepositoryRail` AND the stage's
 * `TabStrip` together, and both carry a row for the same tab key, so two
 * listeners answered one keystroke with two popovers. Ownership is explicit
 * now — the rail takes it whenever it is mounted (its row is what the user is
 * looking at, and its popover is the one with the workspace-logo actions), and
 * `TabStrip` takes it only in top-tab mode, where there is no rail. Exactly one
 * consumer per request, again, but by construction rather than by luck.
 */
export const requestTabOptionsKey = signal<number | null>(null);
export const statusInfo = signal<StatusInfo>({
  branch: null,
  cwd: null,
  agent: null,
  paneCount: 1,
  home: "",
});
