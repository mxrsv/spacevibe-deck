/**
 * Fixtures for the project-first rail's view-model tests. Every one goes through
 * `buildAgentRail` from `PaneView`/`TabView`, the way the rail will: AC-2 asks
 * for a projection over existing tab views and attention state, not over
 * hand-made rows. The clock is the fixed `NOW`.
 */
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { buildAgentRail, type AgentRailView } from "./agent-rail-model";
import { buildRailView, type RailItem, type RailViewModel } from "./rail-view-model";
import { INITIAL_RAIL_VIEW_STATE, type RailViewState } from "./rail-view-state";

export const MINUTE = 60_000;
export const NOW = 1_700_000_000_000;

export const DECK_KEY = "/w/deck/.git";
export const API_KEY = "plain:/w/api";
export const NOTES_KEY = "plain:/w/notes";

export function pane(paneId: number, over: Partial<PaneView> = {}): PaneView {
  return {
    paneId,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: true,
    changedAt: NOW - 30 * MINUTE,
    ...over,
  };
}

export function tab(
  key: number,
  workspacePath: string,
  panes: readonly PaneView[],
  over: Partial<TabView> = {},
): TabView {
  return {
    key,
    process: "zsh",
    name: null,
    dotColor: null,
    workspacePath,
    agents: [],
    agentBusy: false,
    unread: false,
    panes,
    openedAt: key,
    ...over,
  };
}

function checkout(path: string, branch: string) {
  return {
    path,
    head: "0".repeat(40),
    branch,
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
  };
}

const DECK: RepositoryScan = {
  kind: "repository",
  key: DECK_KEY,
  root: "/w/deck",
  worktrees: [checkout("/w/deck", "main"), checkout("/w/deck-side", "release-hardening")],
};
const SCANS = new Map<string, RepositoryScan>([
  ["/w/deck", DECK],
  ["/w/deck-side", DECK],
]);

export function rail(
  tabs: readonly TabView[],
  tails: ReadonlyMap<number, string> = new Map(),
  titles: ReadonlyMap<number, string> = new Map(),
): AgentRailView {
  return buildAgentRail({
    tabs,
    activeIndex: 0,
    scans: SCANS,
    // `/w/notes` has nothing open: a remembered project with no rows.
    workspaceHistoryPaths: ["/w/deck", "/w/deck-side", "/w/api", "/w/notes"],
    tails,
    titles,
    now: NOW,
  });
}

/**
 * Two stream groups under one `orderKey`: the open tab's scan lists only
 * `/w/deck`, while the history entry `/w/deck-new` scans to the same
 * repository and is no live path's prefix, so it builds a remembered cluster
 * with the live one's key (`coveredHistoryPaths` in `agent-rail-model.ts`).
 */
export function twinRail(): AgentRailView {
  const narrow: RepositoryScan = {
    kind: "repository",
    key: DECK_KEY,
    root: "/w/deck",
    worktrees: [checkout("/w/deck", "main")],
  };
  const wide: RepositoryScan = {
    ...narrow,
    worktrees: [checkout("/w/deck", "main"), checkout("/w/deck-new", "next")],
  };
  return buildAgentRail({
    tabs: [tab(1, "/w/deck", [pane(11, { attention: "requested", changedAt: NOW - MINUTE })])],
    activeIndex: 0,
    scans: new Map([
      ["/w/deck", narrow],
      ["/w/deck-new", wide],
    ]),
    workspaceHistoryPaths: ["/w/deck", "/w/deck-new"],
    tails: new Map(),
    now: NOW,
  });
}

/** A morning: deck asks and works, its side worktree finished, api failed beside a shell. */
export const WORKDAY = rail(
  [
    tab(1, "/w/deck", [
      pane(11, { attention: "requested", changedAt: NOW - 10 * MINUTE }),
      pane(12, { phase: "working", changedAt: NOW - MINUTE }),
    ]),
    tab(2, "/w/deck-side", [
      pane(21, {
        agent: "codex",
        attention: "completed",
        confidence: "inferred",
        changedAt: NOW - 3 * MINUTE,
      }),
    ]),
    tab(3, "/w/api", [pane(31, { attention: "error", changedAt: NOW - 40 * MINUTE })], {
      name: "auth handoff",
    }),
    tab(4, "/w/api", [pane(41, { agent: null })]),
  ],
  new Map([
    [11, "Which migration should run first?"],
    [21, "Token refresh is fixed"],
  ]),
);

export function viewOf(state: Partial<RailViewState> = {}, view = WORKDAY): RailViewModel {
  return buildRailView(view, { ...INITIAL_RAIL_VIEW_STATE, ...state }, NOW);
}

export const ids = (items: readonly RailItem[]) => items.map((item) => item.id);

/** Each group's key and its rows' ids, in render order. */
export const layout = (model: RailViewModel) =>
  model.groups.map((group) => [group.key, ids(group.items)] as const);
