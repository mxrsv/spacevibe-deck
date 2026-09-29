import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../../repositories/repository-client";
import type { PaneView, TabView } from "../../terminal/tabs-store";
import {
  buildSpaces,
  folderName,
  miniColumns,
  needsTone,
  runsByWorkspace,
  spaceAddress,
  spaceCounts,
  spaceLabel,
} from "./space-model";

const DECK = "/Users/deck/spacevibe-deck";
const FIX = "/Users/deck/deck-worktrees/fix-rail";
const API = "/Users/deck/spacevibe-api";

function pane(paneId: number, overrides: Partial<PaneView> = {}): PaneView {
  return {
    paneId,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: false,
    changedAt: 0,
    ...overrides,
  };
}

function tab(key: number, workspacePath: string | null, panes: readonly PaneView[] = []): TabView {
  return {
    key,
    process: null,
    name: null,
    dotColor: null,
    workspacePath,
    agents: [],
    agentBusy: false,
    unread: false,
    panes,
  };
}

const SCANS = new Map<string, RepositoryScan>([
  [
    FIX,
    {
      kind: "repository",
      key: `${DECK}/.git`,
      root: DECK,
      worktrees: [
        {
          path: DECK,
          head: null,
          branch: "main",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
        {
          path: FIX,
          head: null,
          branch: "fix/rail",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
      ],
    },
  ],
]);

describe("folderName", () => {
  it("names a space by the last path segment on either separator", () => {
    expect(folderName(DECK)).toBe("spacevibe-deck");
    expect(folderName("C:\\work\\api\\")).toBe("api");
    expect(folderName(null)).toBe("~");
  });
});

describe("buildSpaces", () => {
  const tabs = [
    tab(10, DECK, [pane(1, { attention: "requested" }), pane(2, { agent: null })]),
    tab(11, API, [pane(3, { attention: "error" }), pane(4, { phase: "working" })]),
    tab(12, DECK),
    tab(13, FIX, [pane(5)]),
  ];

  it("follows the caller's order and skips indexes with no tab", () => {
    const spaces = buildSpaces({ tabs, order: [3, 0, 9, 2], activeIndex: 0, scans: SCANS });
    expect(spaces.map((space) => space.tabIndex)).toEqual([3, 0, 2]);
    expect(spaces.map((space) => space.current)).toEqual([false, true, false]);
  });

  it("indexes only spaces that share a workspace, 1-based in display order", () => {
    const spaces = buildSpaces({ tabs, order: [2, 1, 0], activeIndex: 0, scans: SCANS });
    expect(spaces.map(spaceLabel)).toEqual([
      "spacevibe-deck 1",
      "spacevibe-api",
      "spacevibe-deck 2",
    ]);
  });

  it("carries the tab's name; the label is the name, the address stays folder and index", () => {
    const named = [{ ...tab(10, DECK), name: "auth" }, tab(12, DECK)];
    const [first, second] = buildSpaces({
      tabs: named,
      order: [0, 1],
      activeIndex: 0,
      scans: SCANS,
    });
    expect([first.name, second.name]).toEqual(["auth", null]);
    expect([spaceLabel(first), spaceLabel(second)]).toEqual(["auth", "spacevibe-deck 2"]);
    // The name never renumbers its neighbours.
    expect([spaceAddress(first), spaceAddress(second)]).toEqual([
      "spacevibe-deck 1",
      "spacevibe-deck 2",
    ]);
  });

  it("counts agents and needs-you from the rail's own state words", () => {
    const [deck, api] = buildSpaces({ tabs, order: [0, 1], activeIndex: 0, scans: SCANS });
    expect(deck.panes.map((item) => item.state)).toEqual(["asked", "shell"]);
    expect([deck.agentCount, deck.needsCount]).toEqual([1, 1]);
    expect([api.agentCount, api.needsCount, api.failedCount]).toEqual([2, 1, 1]);
    expect(deck.failedCount).toBe(0);
    expect(spaceCounts(api)).toBe("2 agents · 1 need you");
    expect(spaceCounts({ agentCount: 1, needsCount: 0 })).toBe("1 agent");
  });

  it("keeps a departed agent's pane as an agent", () => {
    const [space] = buildSpaces({
      tabs: [tab(1, DECK, [pane(1, { agent: null, lastAgent: "codex", phase: "exited" })])],
      order: [0],
      activeIndex: 0,
      scans: SCANS,
    });
    expect(space.panes[0]).toEqual({ paneId: 1, agent: "codex", state: "ended" });
    expect(space.agentCount).toBe(1);
  });

  it("reads the branch from a repository scan and leaves it null otherwise", () => {
    const spaces = buildSpaces({ tabs, order: [3, 1], activeIndex: 3, scans: SCANS });
    expect(spaces.map((space) => space.branch)).toEqual(["fix/rail", null]);
  });
});

describe("needsTone", () => {
  it("is red once anything failed, yellow for a question, else nothing (DL-3.2)", () => {
    expect(needsTone({ needsCount: 2, failedCount: 1 })).toBe("failed");
    expect(needsTone({ needsCount: 1, failedCount: 0 })).toBe("asked");
    expect(needsTone({ needsCount: 0, failedCount: 0 })).toBeNull();
  });
});

describe("runsByWorkspace", () => {
  it("groups only consecutive spaces on one workspace", () => {
    const spaces = buildSpaces({
      tabs: [tab(1, DECK), tab(2, DECK), tab(3, API), tab(4, DECK)],
      order: [0, 1, 2, 3],
      activeIndex: 0,
      scans: new Map(),
    });
    expect(runsByWorkspace(spaces).map((run) => run.map((space) => space.key))).toEqual([
      [1, 2],
      [3],
      [4],
    ]);
  });
});

describe("miniColumns", () => {
  it("draws the smallest square grid that holds the panes", () => {
    expect([0, 1, 2, 4, 5, 9, 10].map(miniColumns)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });
});
