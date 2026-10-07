import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { buildAgentRail, type AgentRailInput } from "./agent-rail-model";
import { buildRailAvatars } from "./agent-rail-collapsed-model";

const NOW = 1_700_000_000_000;

const IDLE = {
  kind: "idle",
  actionableCount: 0,
  workingCount: 0,
  unreadCount: 0,
} as const;

function pane(paneId: number, over: Partial<PaneView> = {}): PaneView {
  return {
    paneId,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: true,
    changedAt: NOW - 60_000,
    ...over,
  };
}

function tab(key: number, workspacePath: string, over: Partial<TabView> = {}): TabView {
  return {
    key,
    process: "zsh",
    name: null,
    dotColor: null,
    workspacePath,
    agents: [],
    agentBusy: false,
    unread: false,
    attention: IDLE,
    ...over,
  };
}

function repo(key: string, paths: readonly string[]): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: paths[0],
    worktrees: paths.map((path) => ({
      path,
      head: "0".repeat(40),
      branch: null,
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    })),
  };
}

const DECK = repo("/w/deck/.git", ["/w/deck", "/w/deck-side"]);
const API = repo("/w/api/.git", ["/w/api"]);
const SCANS = new Map<string, RepositoryScan>([
  ["/w/deck", DECK],
  ["/w/deck-side", DECK],
  ["/w/api", API],
]);

function railInput(over: Partial<AgentRailInput> = {}): AgentRailInput {
  return {
    tabs: [],
    activeIndex: 0,
    scans: SCANS,
    workspaceHistoryPaths: ["/w/deck", "/w/api"],
    now: NOW,
    ...over,
  };
}

describe("buildRailAvatars (DL-27.29)", () => {
  it("draws one avatar per live project and omits remembered ones", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        workspaceHistoryPaths: ["/w/deck", "/w/api", "/home/me/scratch"],
      }),
    );

    expect(view.stream.map((group) => group.project)).toContain("api");
    expect(buildRailAvatars(view).map((avatar) => avatar.project)).toEqual(["deck"]);
  });

  it("follows the stored rail order, as the tree does", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] }), tab(2, "/w/api", { panes: [pane(2)] })],
        railOrder: ["/w/api/.git"],
      }),
    );

    expect(buildRailAvatars(view).map((avatar) => avatar.project)).toEqual(["api", "deck"]);
  });

  it("counts asked and failed panes across checkouts, red when any failed", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { attention: "requested" }), pane(2, { attention: "none" })],
          }),
          tab(2, "/w/deck-side", { panes: [pane(3, { attention: "error", phase: "exited" })] }),
          tab(3, "/w/api", { panes: [pane(4, { attention: "warning" })] }),
        ],
      }),
    );

    const [deck, api] = buildRailAvatars(view);

    expect(deck).toMatchObject({ project: "deck", needCount: 2, failed: true });
    expect(deck.needWords).toBe("2 need you, 1 failed");
    expect(api).toMatchObject({ project: "api", needCount: 1, failed: false });
    expect(api.needWords).toBe("1 need you");
  });

  it("reports zero for a project with nobody waiting", () => {
    const view = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/api", { panes: [pane(1, { phase: "working" })] })] }),
    );

    expect(buildRailAvatars(view)[0]).toMatchObject({ needCount: 0, failed: false });
  });

  it("marks only the project that owns the selected tab as current", () => {
    const tabs = [tab(1, "/w/deck", { panes: [pane(1)] }), tab(2, "/w/api", { panes: [pane(2)] })];

    const onApi = buildRailAvatars(buildAgentRail(railInput({ tabs, activeIndex: 1 })));

    expect(onApi.map((avatar) => [avatar.project, avatar.current])).toEqual([
      ["deck", false],
      ["api", true],
    ]);
  });

  it("names the icon path after the repository root, like the header", () => {
    const view = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/deck-side", { panes: [pane(1)] })] }),
    );

    expect(buildRailAvatars(view)[0].iconPath).toBe("/w/deck");
  });
});
