import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView, TabView } from "../terminal/tabs-store";
import {
  STRIP_VISIBLE,
  buildAgentRail,
  formatShortAge,
  paneSignal,
  stripSegments,
  tabTail,
  type AgentRailInput,
  type AgentRailView,
  type RailCardPane,
  type RailStreamGroup,
} from "./agent-rail-model";

/**
 * The stream's rows in render order, flattened out of their clusters AND their
 * worktree groups (DL-27.23) — the shape the rail draws, one array.
 */
function streamRows(view: AgentRailView) {
  return view.stream.flatMap((group) => clusterRows(group));
}

/** Every row of one cluster, across its checkouts, in render order. */
function clusterRows(group: RailStreamGroup) {
  return group.worktrees.flatMap((worktree) => worktree.rows);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** A round clock, so every `changedAt` in a fixture reads as "now minus X". */
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
    // The default fixture pane has run and been checked: `done`. Tests that
    // want `idle` say `hasRun: false` themselves.
    hasRun: true,
    changedAt: NOW - MINUTE,
    ...over,
  };
}

function tab(key: number, workspacePath: string | null, over: Partial<TabView> = {}): TabView {
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

function repo(
  key: string,
  worktrees: readonly { path: string; branch?: string }[],
): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: worktrees[0].path,
    worktrees: worktrees.map((entry) => ({
      path: entry.path,
      head: "0".repeat(40),
      branch: entry.branch ?? null,
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    })),
  };
}

/** One repository, a primary checkout plus a second worktree. */
const DECK = repo("/w/deck/.git", [
  { path: "/w/deck", branch: "main" },
  { path: "/w/deck-side", branch: "release-hardening" },
]);

const DECK_SCANS = new Map<string, RepositoryScan>([
  ["/w/deck", DECK],
  ["/w/deck-side", DECK],
]);

function railInput(over: Partial<AgentRailInput> = {}): AgentRailInput {
  return {
    tabs: [],
    activeIndex: 0,
    scans: DECK_SCANS,
    workspaceHistoryPaths: ["/w/deck", "/w/deck-side"],
    now: NOW,
    ...over,
  };
}

describe("formatShortAge", () => {
  it("returns nothing when the tracker has never seen a change", () => {
    // Not "0m": a zero would claim something happened this second.
    expect(formatShortAge(0, NOW)).toBe("");
  });

  it("reads `now` under a minute, and for a clock that ran backwards", () => {
    expect(formatShortAge(NOW, NOW)).toBe("now");
    expect(formatShortAge(NOW - 59_999, NOW)).toBe("now");
    expect(formatShortAge(NOW + HOUR, NOW)).toBe("now");
  });

  it("crosses each unit boundary at the exact tick", () => {
    expect(formatShortAge(NOW - MINUTE, NOW)).toBe("1m");
    expect(formatShortAge(NOW - 14 * MINUTE, NOW)).toBe("14m");
    expect(formatShortAge(NOW - (HOUR - 1), NOW)).toBe("59m");
    expect(formatShortAge(NOW - HOUR, NOW)).toBe("1h");
    expect(formatShortAge(NOW - 3 * HOUR, NOW)).toBe("3h");
    expect(formatShortAge(NOW - (DAY - 1), NOW)).toBe("23h");
    expect(formatShortAge(NOW - DAY, NOW)).toBe("1d");
    expect(formatShortAge(NOW - 2 * DAY, NOW)).toBe("2d");
    expect(formatShortAge(NOW - (WEEK - 1), NOW)).toBe("6d");
    expect(formatShortAge(NOW - WEEK, NOW)).toBe("1w");
    expect(formatShortAge(NOW - 5 * WEEK, NOW)).toBe("5w");
  });

  it("keeps weeks as the largest unit", () => {
    expect(formatShortAge(NOW - 60 * WEEK, NOW)).toBe("60w");
  });
});

describe("buildAgentRail state mapping", () => {
  it("maps every pane snapshot to its rail state, spec §3", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [
              pane(1, { attention: "error" }),
              pane(2, { attention: "requested" }),
              pane(3, { attention: "warning" }),
              pane(4, { attention: "completed" }),
              pane(5, { attention: "none", phase: "working" }),
              pane(6, { attention: "none", phase: "idle" }),
              pane(7, { attention: "none", phase: "idle", hasRun: false }),
            ],
          }),
        ],
      }),
    );

    // `completed` folds into `asked` (owner merge, 2026-08-16), and a quiet
    // pane splits on `hasRun`: checked run → done, never ran → idle.
    const row = streamRows(view)[0];
    expect(row.panes.map((entry) => entry.state)).toEqual([
      "failed",
      "asked",
      "asked",
      "asked",
      "working",
      "done",
      "idle",
    ]);
  });

  it("reads attention before phase, so a latched warning beats live work", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { attention: "warning", phase: "working" })],
          }),
        ],
      }),
    );

    expect(streamRows(view)[0].panes[0].state).toBe("asked");
    expect(streamRows(view)[0].state).toBe("asked");
  });

  it("never lets a crashed agent read as idle", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { attention: "error", phase: "exited" })],
          }),
        ],
      }),
    );

    // Since 2026-08-16 a failed tab stays in its own project's cluster — the
    // mark carries the failure, the list does not move the row to carry it.
    expect(streamRows(view)).toHaveLength(1);
    expect(streamRows(view)[0].state).toBe("failed");
  });
});

describe("paneSignal — the sixth word and the confidence beside it (DL-27.3, 2026-09-03)", () => {
  it("reads an exited pane with nothing latched as ended", () => {
    expect(paneSignal(pane(1, { phase: "exited" }))).toEqual({
      state: "ended",
      confidence: "unknown",
    });
    expect(paneSignal(pane(1, { phase: "exited", phaseConfidence: "explicit" }))).toEqual({
      state: "ended",
      confidence: "explicit",
    });
  });

  it("lets a latched error or warning outrank the end — the CLI said it, the exit does not un-say it", () => {
    expect(paneSignal(pane(1, { phase: "exited", attention: "error" })).state).toBe("failed");
    expect(paneSignal(pane(1, { phase: "exited", attention: "warning" })).state).toBe("asked");
  });

  it("takes the attention axis's confidence for failed and asked", () => {
    expect(paneSignal(pane(1, { attention: "completed", confidence: "inferred" }))).toEqual({
      state: "asked",
      confidence: "inferred",
    });
    expect(paneSignal(pane(1, { attention: "requested", confidence: "explicit" }))).toEqual({
      state: "asked",
      confidence: "explicit",
    });
    expect(paneSignal(pane(1, { attention: "error" })).confidence).toBe("explicit");
  });

  it("takes the phase axis's confidence for working, done and idle", () => {
    expect(paneSignal(pane(1, { phase: "working", phaseConfidence: "inferred" }))).toEqual({
      state: "working",
      confidence: "inferred",
    });
    expect(
      paneSignal(pane(1, { phase: "idle", hasRun: true, phaseConfidence: "inferred" })),
    ).toEqual({ state: "done", confidence: "inferred" });
    expect(paneSignal(pane(1, { phase: "idle", hasRun: false }))).toEqual({
      state: "idle",
      confidence: "unknown",
    });
  });

  it("reads an absent confidence as today's defaults — explicit attention, unknown phase", () => {
    // A fixture or a seed built before the fields existed.
    const legacy: PaneView = {
      paneId: 9,
      agent: "claude",
      attention: "none",
      phase: "idle",
      hasRun: true,
      changedAt: NOW,
    };
    expect(paneSignal(legacy)).toEqual({ state: "done", confidence: "unknown" });
    expect(paneSignal({ ...legacy, attention: "completed" })).toEqual({
      state: "asked",
      confidence: "explicit",
    });
  });

  it("carries the confidence onto every rail row, and folds ended above working", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [
              pane(1, { phase: "working", phaseConfidence: "explicit" }),
              pane(2, { phase: "exited", phaseConfidence: "explicit" }),
              pane(3, { attention: "completed", confidence: "inferred" }),
            ],
          }),
        ],
      }),
    );
    const row = streamRows(view)[0];
    expect(row.panes.map((entry) => [entry.state, entry.confidence])).toEqual([
      ["working", "explicit"],
      ["ended", "explicit"],
      ["asked", "inferred"],
    ]);
    // failed > asked > ended > working > done > idle: the asked pane speaks.
    expect(row.state).toBe("asked");
    expect(row.voice?.paneId).toBe(3);
  });

  it("an ended pane outranks a working one when nothing is asked", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { phase: "working" }), pane(2, { phase: "exited" })],
          }),
        ],
      }),
    );
    expect(streamRows(view)[0].state).toBe("ended");
  });
});

describe("buildAgentRail folding", () => {
  it("folds a multi-agent tab to its loudest pane, DL-27.3", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [
              pane(1, { agent: "codex", phase: "working" }),
              pane(2, { agent: "gemini", attention: "completed" }),
              pane(3, { agent: "claude", attention: "error" }),
            ],
          }),
        ],
      }),
    );

    const row = streamRows(view)[0];
    expect(row.state).toBe("failed");
    expect(row.voice?.agent).toBe("claude");
    expect(row.panes).toHaveLength(3);
  });

  it("never reorders a row by its severity", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            openedAt: 1,
            panes: [pane(1, { attention: "requested", changedAt: NOW })],
          }),
          tab(2, "/w/deck", {
            openedAt: 2,
            panes: [pane(2, { attention: "error", changedAt: NOW - HOUR })],
          }),
          tab(3, "/w/deck", {
            openedAt: 3,
            panes: [pane(3, { attention: "completed", changedAt: NOW })],
          }),
        ],
      }),
    );

    // A failed tab does not climb over an asked one: the list stays where the
    // user put it and the marks say what happened (2026-08-16). The third
    // tab's `completed` reads as asked under the owner's merge.
    expect(streamRows(view).map((row) => row.state)).toEqual(["asked", "failed", "asked"]);
  });

  it("takes the newest pane when two panes share the loudest state", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [
              pane(1, {
                agent: "codex",
                attention: "requested",
                changedAt: NOW - HOUR,
              }),
              pane(2, {
                agent: "claude",
                attention: "requested",
                changedAt: NOW - MINUTE,
              }),
            ],
          }),
        ],
      }),
    );

    expect(streamRows(view)[0].voice?.paneId).toBe(2);
  });
});

describe("buildAgentRail ordering", () => {
  it("keeps every tab in the stream, in the order they were opened", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            openedAt: 3,
            panes: [pane(1, { phase: "working", changedAt: NOW - 3 * MINUTE })],
          }),
          tab(2, "/w/deck", {
            openedAt: 1,
            panes: [pane(2, { attention: "completed", changedAt: NOW - HOUR })],
          }),
          tab(3, "/w/deck", {
            openedAt: 2,
            panes: [pane(3, { phase: "idle", changedAt: NOW - MINUTE })],
          }),
        ],
      }),
    );

    // The open key, not the tab array and not recency: reopening a tab puts it
    // at the end of the strip, and the rail agrees with the strip.
    expect(streamRows(view).map((row) => row.key)).toEqual([2, 3, 1]);
  });

  it("falls back to tab order for tabs that carry no open key", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { changedAt: NOW - HOUR })],
          }),
          tab(2, "/w/deck", {
            panes: [pane(2, { changedAt: NOW })],
          }),
        ],
      }),
    );

    expect(streamRows(view).map((row) => row.key)).toEqual([1, 2]);
  });

  it("does not mutate the tabs it was given", () => {
    const tabs = [
      tab(1, "/w/deck", {
        panes: [pane(1, { attention: "requested", changedAt: NOW - HOUR })],
      }),
      tab(2, "/w/deck", { panes: [pane(2, { attention: "error" })] }),
    ];
    const snapshot = tabs.map((entry) => entry.key);

    buildAgentRail(railInput({ tabs }));

    expect(tabs.map((entry) => entry.key)).toEqual(snapshot);
  });
});

describe("buildAgentRail rows", () => {
  it("names the project on every row, and the checkout on none of them", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { panes: [pane(1)] }),
          tab(2, "/w/deck-side", { panes: [pane(2)] }),
        ],
      }),
    );

    // DL-27.23: the branch is the GROUP's word, not the row's — a suffix would
    // print it once per agent in the checkout.
    expect(streamRows(view).map((row) => row.project)).toEqual(["deck", "deck"]);
    expect(streamRows(view).every((row) => !("worktree" in row))).toBe(true);
    expect(view.stream[0].worktrees.map((worktree) => worktree.branch)).toEqual([
      "main",
      "release-hardening",
    ]);
  });

  it("carries the tab's index, key, workspace path and active flag", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(7, "/w/deck"), tab(9, "/w/deck-side")],
        activeIndex: 1,
      }),
    );

    expect(streamRows(view).map((row) => [row.key, row.index, row.active])).toEqual([
      [7, 0, false],
      [9, 1, true],
    ]);
    expect(streamRows(view)[0].workspacePath).toBe("/w/deck");
  });

  it("titles a row with the custom name when the user set one", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { name: "api handoff", panes: [pane(1)] })],
      }),
    );

    expect(streamRows(view)[0].title).toBe("api handoff");
    expect(streamRows(view)[0].named).toBe(true);
    // A title is not a turn: with no tail for this pane the row has nothing
    // the agent said, and the name stands on the row by itself (DL-27.15,
    // amended 2026-08-17).
    expect(streamRows(view)[0].panes[0].message).toBe("");
  });

  it("takes the newest agent pane's change as the row's age", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [
              pane(1, { changedAt: NOW - 3 * HOUR }),
              pane(2, { changedAt: NOW - 14 * MINUTE }),
            ],
          }),
        ],
      }),
    );

    expect(streamRows(view)[0].changedAt).toBe(NOW - 14 * MINUTE);
    expect(streamRows(view)[0].age).toBe("14m");
  });

  it("keeps a tab with no recognised agent as a row, idle and voiceless", () => {
    // The rail is the sidebar's only list: a tab it declines to draw is a tab
    // the user cannot reach from there (spec §9 drops shell ROWS, not tabs).
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [
              pane(1, { agent: null, phase: "working", changedAt: NOW }),
              pane(2, { agent: null, changedAt: NOW }),
            ],
          }),
        ],
      }),
    );

    expect(streamRows(view)).toHaveLength(1);
    expect(streamRows(view)[0]).toMatchObject({
      state: "idle",
      voice: null,
      panes: [],
      changedAt: 0,
      age: "",
      title: "deck",
    });
  });

  it("keeps a tab whose panes have not been reported yet", () => {
    const view = buildAgentRail(railInput({ tabs: [tab(1, "/w/deck")] }));

    expect(streamRows(view)).toHaveLength(1);
    expect(streamRows(view)[0].panes).toEqual([]);
  });

  it("keeps a tab in a folder that is not a repository", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/home/me/scratch", { panes: [pane(1)] })],
        scans: new Map([["/home/me/scratch", { kind: "plain", reason: "not a git repository" }]]),
        workspaceHistoryPaths: [],
      }),
    );

    expect(streamRows(view)[0]).toMatchObject({ project: "scratch" });
    // One implicit, UNLABELLED group (DL-27.23): the folder's only name is the
    // one the cluster header above it already prints, so no sub-header is
    // drawn — which is also every project under Tauri, where no scan resolves.
    expect(view.stream[0].worktrees.map((worktree) => worktree.labelled)).toEqual([false]);
  });
});

describe("buildAgentRail clusters", () => {
  /** A second repository, so a fixture can hold two projects at once. */
  const API = repo("/w/api/.git", [{ path: "/w/api", branch: "main" }]);
  const TWO_PROJECT_SCANS = new Map<string, RepositoryScan>([
    ["/w/deck", DECK],
    ["/w/deck-side", DECK],
    ["/w/api", API],
  ]);

  function twoProjects(over: Partial<AgentRailInput> = {}): AgentRailInput {
    return railInput({
      scans: TWO_PROJECT_SCANS,
      workspaceHistoryPaths: ["/w/deck", "/w/deck-side", "/w/api"],
      ...over,
    });
  }

  it("labels every project, including a project with one tab", () => {
    const view = buildAgentRail(
      twoProjects({
        tabs: [
          tab(1, "/w/deck", { panes: [pane(1, { changedAt: NOW - MINUTE })] }),
          tab(2, "/w/deck", { panes: [pane(2, { changedAt: NOW })] }),
          tab(3, "/w/api", { panes: [pane(3, { changedAt: NOW - HOUR })] }),
        ],
      }),
    );

    expect(
      view.stream.map((group) => [group.project, group.labelled, clusterRows(group).length]),
    ).toEqual([
      // Deck was opened first, so its cluster leads. Both projects keep the
      // same project → tab hierarchy regardless of their tab count.
      ["deck", true, 2],
      ["api", true, 1],
    ]);
    // Inside a cluster the rows keep the order they were opened in.
    expect(clusterRows(view.stream[0]).map((row) => row.key)).toEqual([1, 2]);
  });

  it("orders clusters by their oldest tab, not by name or by recency", () => {
    const view = buildAgentRail(
      twoProjects({
        tabs: [
          tab(1, "/w/deck", {
            openedAt: 2,
            panes: [pane(1, { changedAt: NOW - HOUR })],
          }),
          tab(2, "/w/api", {
            openedAt: 1,
            panes: [pane(2, { changedAt: NOW })],
          }),
          // Opened last, into the project that already leads: a second tab
          // never moves the project it joins.
          tab(3, "/w/api", {
            openedAt: 3,
            panes: [pane(3, { changedAt: NOW - 2 * HOUR })],
          }),
        ],
      }),
    );

    expect(view.stream.map((group) => group.project)).toEqual(["api", "deck"]);
  });

  it("falls back to tab order for clusters nothing has happened in", () => {
    const view = buildAgentRail(twoProjects({ tabs: [tab(1, "/w/api"), tab(2, "/w/deck")] }));

    expect(view.stream.map((group) => group.project)).toEqual(["api", "deck"]);
  });

  it("keeps an actionable tab inside its own project's cluster", () => {
    const view = buildAgentRail(
      twoProjects({
        tabs: [
          tab(1, "/w/deck", { panes: [pane(1, { attention: "requested" })] }),
          tab(2, "/w/deck", { panes: [pane(2)] }),
          tab(3, "/w/deck", { panes: [pane(3)] }),
        ],
      }),
    );

    // One LIVE project, printed once, with all three of its tabs under it;
    // the history's api project follows as a rowless remembered cluster.
    expect(view.stream.map((group) => [group.project, clusterRows(group).length])).toEqual([
      ["deck", 3],
      ["api", 0],
    ]);
    expect(view.stream[0].labelled).toBe(true);
    expect(clusterRows(view.stream[0]).map((row) => row.key)).toEqual([1, 2, 3]);
    expect(clusterRows(view.stream[0])[0].state).toBe("asked");
  });

  it("keeps a project whose only tab wants the user", () => {
    const view = buildAgentRail(
      twoProjects({
        tabs: [tab(1, "/w/deck", { panes: [pane(1, { attention: "error" })] })],
      }),
    );

    expect(view.stream.map((group) => [group.project, group.labelled])).toEqual([
      ["deck", true],
      // The history's api project trails as a rowless remembered cluster.
      ["api", true],
    ]);
    expect(clusterRows(view.stream[0])[0].state).toBe("failed");
  });

  it("names a row by its agents, its own name, or shell", () => {
    const view = buildAgentRail(
      twoProjects({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { agent: "claude" }), pane(2, { agent: "codex" })],
          }),
          tab(2, "/w/deck", { name: "api handoff", panes: [pane(3)] }),
          tab(3, "/w/deck", { panes: [pane(4, { agent: null })] }),
        ],
      }),
    );

    // An unnamed multi-agent tab has NO identity: the pane tree under the row
    // is the identity, and even its count was declared noise (DL-27.13).
    expect(streamRows(view).map((row) => row.identity)).toEqual(["", "api handoff", "shell"]);
  });

  it("leaves the turn empty until an agent has actually spoken", () => {
    // Neither a derived title nor a typed one is a turn: the message carries
    // what an agent said and nothing else, so a row with no tail has none —
    // its name holds the row's one line instead (DL-27.15, 2026-08-17).
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { panes: [pane(1)] }),
          tab(2, "/w/deck", { name: "api handoff", panes: [pane(2)] }),
        ],
      }),
    );

    expect(streamRows(view).map((row) => row.message)).toEqual(["", ""]);
    expect(streamRows(view).map((row) => row.named)).toEqual([false, true]);
    expect(streamRows(view)[0].panes[0].message).toBe("");
  });

  it("puts a tab of a secondary checkout under that checkout's own group", () => {
    const view = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/deck-side", { panes: [pane(1)] })] }),
    );

    // The primary leads even with nothing open in it (spec §4): it is the
    // project's anchor, not a reward for being busy. The tab's row is under
    // the branch it runs on, and says nothing about the checkout itself.
    expect(
      view.stream[0].worktrees.map((worktree) => [worktree.branch, worktree.rows.length]),
    ).toEqual([
      ["main", 0],
      ["release-hardening", 1],
    ]);
    expect(streamRows(view)[0]).toMatchObject({ message: "" });
  });
});

describe("buildAgentRail worktree groups (DL-27.23, 2026-08-25)", () => {
  /** A repository with three checkouts, so ordering has something to say. */
  const TRIO = repo("/w/trio/.git", [
    { path: "/w/trio", branch: "main" },
    { path: "/w/trio-a", branch: "feat/a" },
    { path: "/w/trio-b", branch: "feat/b" },
  ]);
  const TRIO_SCANS = new Map<string, RepositoryScan>([
    ["/w/trio", TRIO],
    ["/w/trio-a", TRIO],
    ["/w/trio-b", TRIO],
  ]);

  function trio(over: Partial<AgentRailInput> = {}): AgentRailInput {
    return railInput({
      scans: TRIO_SCANS,
      workspaceHistoryPaths: ["/w/trio", "/w/trio-a", "/w/trio-b"],
      ...over,
    });
  }

  it("groups a project's tabs by the checkout they run in", () => {
    const view = buildAgentRail(
      trio({
        tabs: [
          tab(1, "/w/trio", { openedAt: 1, panes: [pane(1)] }),
          tab(2, "/w/trio-a", { openedAt: 2, panes: [pane(2)] }),
          tab(3, "/w/trio", { openedAt: 3, panes: [pane(3)] }),
          tab(4, "/w/trio-a", { openedAt: 4, panes: [pane(4)] }),
        ],
      }),
    );

    // The flat list interleaved these four rows 1-2-3-4; grouped, each
    // checkout's runs stand together and the branch is said once per group.
    expect(
      view.stream[0].worktrees.map((worktree) => [
        worktree.branch,
        worktree.rows.map((row) => row.key),
      ]),
    ).toEqual([
      ["main", [1, 3]],
      ["feat/a", [2, 4]],
      ["feat/b", []],
    ]);
  });

  it("orders the groups: primary, then earliest-open, then history-only", () => {
    const view = buildAgentRail(
      trio({
        tabs: [
          // `feat/b` was opened first, so it leads `feat/a` — and the primary
          // leads them both with nothing open in it at all.
          tab(1, "/w/trio-b", { openedAt: 1, panes: [pane(1)] }),
          tab(2, "/w/trio-a", { openedAt: 2, panes: [pane(2)] }),
        ],
      }),
    );

    expect(view.stream[0].worktrees.map((worktree) => worktree.branch)).toEqual([
      "main",
      "feat/b",
      "feat/a",
    ]);
    expect(view.stream[0].worktrees.map((worktree) => worktree.primary)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("keeps a group's rows in open order, and the cluster where its oldest tab put it", () => {
    const view = buildAgentRail(
      trio({
        scans: new Map([...TRIO_SCANS, ["/w/deck", DECK], ["/w/deck-side", DECK]]),
        workspaceHistoryPaths: ["/w/trio", "/w/deck"],
        tabs: [
          tab(1, "/w/deck", { openedAt: 2, panes: [pane(1)] }),
          tab(2, "/w/trio-a", { openedAt: 1, panes: [pane(2)] }),
        ],
      }),
    );

    // Grouping moves no cluster: `trio` still leads because its oldest tab
    // does, even though that tab is in a secondary checkout.
    expect(view.stream.map((group) => group.project)).toEqual(["trio", "deck"]);
  });

  it("keeps a checkout the user has worked in before, with nothing open in it", () => {
    const view = buildAgentRail(
      trio({
        workspaceHistoryPaths: ["/w/trio", "/w/trio-b"],
        tabs: [tab(1, "/w/trio", { openedAt: 1, panes: [pane(1)] })],
      }),
    );

    // `feat/a` is never printed — git knows it, Deck has never opened it — and
    // `feat/b` keeps a header with no rows: a place to return to.
    expect(
      view.stream[0].worktrees.map((worktree) => [worktree.branch, worktree.rows.length]),
    ).toEqual([
      ["main", 1],
      ["feat/b", 0],
    ]);
  });

  it("labels every group of a repository, including a project with one checkout", () => {
    const view = buildAgentRail(
      railInput({
        scans: new Map([["/w/solo", repo("/w/solo/.git", [{ path: "/w/solo", branch: "main" }])]]),
        workspaceHistoryPaths: ["/w/solo"],
        tabs: [tab(1, "/w/solo", { panes: [pane(1)] })],
      }),
    );

    expect(
      view.stream[0].worktrees.map((worktree) => [worktree.branch, worktree.labelled]),
    ).toEqual([["main", true]]);
  });

  it("carries the worktree ROOT as the group's path, never a tab's cwd", () => {
    const view = buildAgentRail(
      trio({
        // The scan map is keyed by the WORKSPACE path the tab was opened on;
        // `buildRail` then attaches that tab to its checkout by longest prefix.
        scans: new Map([...TRIO_SCANS, ["/w/trio-a/packages/web", TRIO]]),
        tabs: [tab(1, "/w/trio-a/packages/web", { openedAt: 1, panes: [pane(1)] })],
      }),
    );

    const group = view.stream[0].worktrees.find((worktree) => worktree.branch === "feat/a");
    expect(group?.path).toBe("/w/trio-a");
    expect(group?.key).toBe("/w/trio-a");
    expect(group?.rows.map((row) => row.workspacePath)).toEqual(["/w/trio-a/packages/web"]);
  });

  it("keeps the project's close project-level, across every checkout", () => {
    const view = buildAgentRail(
      trio({
        tabs: [
          tab(1, "/w/trio-a", { openedAt: 1, panes: [pane(1)] }),
          tab(2, "/w/trio", { openedAt: 2, panes: [pane(2)] }),
        ],
      }),
    );

    expect(view.stream[0].tabIndexes).toEqual([0, 1]);
  });

  it("names the REPOSITORY on every checkout, even one that has no row of its own", () => {
    // The shape that broke it (code review, 2026-08-31): someone works only
    // inside a linked worktree and never opens the main checkout, so
    // `filterRailToWorkspaceHistory` drops `/w/trio` from `group.worktrees`
    // before the card model sees it. Searching that array for `primary` then
    // found nothing and fell through to the first survivor — the worktree —
    // so `Create branch from here` proposed a destination beside the worktree
    // rather than beside the repository.
    const view = buildAgentRail(
      trio({
        workspaceHistoryPaths: ["/w/trio-a"],
        tabs: [tab(1, "/w/trio-a", { openedAt: 1, panes: [pane(1)] })],
      }),
    );

    // The primary checkout really is gone from the rendered tier...
    expect(view.stream[0].worktrees.map((worktree) => worktree.path)).toEqual(["/w/trio-a"]);
    // ...and the repository is still the repository.
    expect(view.stream[0].worktrees.map((worktree) => worktree.repositoryPath)).toEqual([
      "/w/trio",
    ]);
  });
});

describe("buildAgentRail worktree card shape (Task 4, 2026-08-26)", () => {
  it("flattens panes across a worktree's tabs in open order", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { openedAt: 2, panes: [pane(3), pane(4)] }),
          tab(2, "/w/deck", { openedAt: 1, panes: [pane(5)] }),
        ],
      }),
    );

    // Tab 2 opened first, so its pane leads; tab 1's two panes follow in
    // their own pane order.
    expect(view.stream[0].worktrees[0].panes.map((entry) => entry.paneId)).toEqual([5, 3, 4]);
  });

  it("names the checkout by basename and badges it by branch", () => {
    const view = buildAgentRail(
      railInput({
        scans: new Map([
          ["/repo/.wt/api", repo("/repo/.git", [{ path: "/repo/.wt/api", branch: "feature/api" }])],
        ]),
        workspaceHistoryPaths: ["/repo/.wt/api"],
        tabs: [tab(1, "/repo/.wt/api", { panes: [pane(1)] })],
      }),
    );

    const worktree = view.stream[0].worktrees[0];
    expect(worktree.name).toBe("api");
    expect(worktree.branch).toBe("feature/api");
  });

  it("marks exactly one worktree active — the focused pane's", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { panes: [pane(1, { focused: true })] }),
          tab(2, "/w/deck-side", { panes: [pane(2, { focused: true })] }),
        ],
        activeIndex: 0,
      }),
    );

    // Every tab has a focused pane of its own; only the ACTIVE tab's is
    // reported (DL-27.22), so only its checkout ever reads active.
    expect(view.stream[0].worktrees.map((worktree) => [worktree.branch, worktree.active])).toEqual([
      ["main", true],
      ["release-hardening", false],
    ]);
  });

  it("marks a shell-only checkout active from its selected tab", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { panes: [pane(1, { agent: null })] }),
          tab(2, "/w/deck-side", { panes: [pane(2, { agent: null })] }),
        ],
        activeIndex: 1,
      }),
    );

    expect(view.stream[0].worktrees.map((worktree) => [worktree.branch, worktree.active])).toEqual([
      ["main", false],
      ["release-hardening", true],
    ]);
  });

  it("reports live only while a pane is working", () => {
    const idle = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/deck", { panes: [pane(1, { phase: "idle" })] })] }),
    );
    const working = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/deck", { panes: [pane(1, { phase: "working" })] })] }),
    );

    expect(idle.stream[0].worktrees[0].live).toBe(false);
    expect(working.stream[0].worktrees[0].live).toBe(true);
  });

  it("ages the card by its newest pane, not by its first tab", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { openedAt: 1, panes: [pane(1, { changedAt: NOW - 3 * HOUR })] }),
          tab(2, "/w/deck", { openedAt: 2, panes: [pane(2, { changedAt: NOW - MINUTE })] }),
        ],
      }),
    );

    expect(view.stream[0].worktrees[0].age).toBe("1m");
  });

  it("labels a split pane with a deterministic ordinal", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { agent: "claude" }), pane(2, { agent: "claude" })],
          }),
        ],
      }),
    );

    expect(view.stream[0].worktrees[0].panes.map((entry) => entry.label)).toEqual([
      "Claude",
      "Claude 2",
    ]);
  });

  it("assigns unique deterministic labels across tabs and a third same-agent pane", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { agent: "claude" }), pane(2, { agent: "claude" })],
          }),
          tab(2, "/w/deck", { panes: [pane(3, { agent: "claude" })] }),
        ],
      }),
    );

    expect(view.stream[0].worktrees[0].panes.map((entry) => entry.label)).toEqual([
      "Claude",
      "Claude 2",
      "Claude 3",
    ]);
  });

  it("lets a tab name a person typed win over the agent name", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { name: "review", panes: [pane(1, { agent: "codex" })] })],
      }),
    );

    expect(view.stream[0].worktrees[0].panes[0].label).toBe("review");
  });

  it("appends an ordinal to a repeated typed name too", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            name: "review",
            panes: [pane(1, { agent: "codex" }), pane(2, { agent: "claude" })],
          }),
        ],
      }),
    );

    expect(view.stream[0].worktrees[0].panes.map((entry) => entry.label)).toEqual([
      "review",
      "review 2",
    ]);
  });

  it("counts split position by agent panes only, skipping a shell pane", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [
              pane(1, { agent: null }),
              pane(2, { agent: "claude" }),
              pane(3, { agent: "claude" }),
            ],
          }),
        ],
      }),
    );

    // The shell pane is not a row (spec §9) and does not count toward "first".
    expect(view.stream[0].worktrees[0].panes.map((entry) => entry.label)).toEqual([
      "Claude",
      "Claude 2",
    ]);
  });

  it("carries the model from the tails input onto its pane", () => {
    const view = buildAgentRail({
      ...railInput({ tabs: [tab(1, "/w/deck", { panes: [pane(101)] })] }),
      models: new Map([[101, "claude-opus-5"]]),
    });

    expect(view.stream[0].worktrees[0].panes[0].model).toBe("claude-opus-5");
  });

  it("defaults a pane's model to empty when nothing is known, and without the input at all", () => {
    const withMap = buildAgentRail({
      ...railInput({ tabs: [tab(1, "/w/deck", { panes: [pane(101)] })] }),
      models: new Map(),
    });
    const withoutInput = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/deck", { panes: [pane(101)] })] }),
    );

    expect(withMap.stream[0].worktrees[0].panes[0].model).toBe("");
    expect(withoutInput.stream[0].worktrees[0].panes[0].model).toBe("");
  });

  it("carries each pane's own tab index, not the group's first tab", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { openedAt: 1, panes: [pane(1)] }),
          tab(2, "/w/deck", { openedAt: 2, panes: [pane(2)] }),
        ],
      }),
    );

    expect(
      view.stream[0].worktrees[0].panes.map((entry) => [entry.paneId, entry.tabIndex]),
    ).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });
});

describe("buildAgentRail session tails", () => {
  /** One agent pane in a renamed tab: a tail to read, a name to keep beside it. */
  function baseInput(): AgentRailInput {
    return railInput({
      tabs: [tab(1, "/w/deck", { name: "review", panes: [pane(101)] })],
    });
  }

  it("reads a pane's tail onto the row that speaks for it", () => {
    const view = buildAgentRail({
      ...baseInput(),
      tails: new Map([[101, "Permission needed: prisma migrate dev"]]),
    });

    const row = streamRows(view)[0];
    expect(row.message).toBe("Permission needed: prisma migrate dev");
    expect(row.panes[0].message).toBe("Permission needed: prisma migrate dev");
  });

  it("says nothing when no tail exists, rather than echoing the name", () => {
    const view = buildAgentRail({ ...baseInput(), tails: new Map() });

    expect(streamRows(view)[0]).toMatchObject({
      message: "",
      identity: "review",
    });
  });

  it("keeps working without the tails input at all", () => {
    const view = buildAgentRail(baseInput());

    expect(streamRows(view)[0].message).toBe("");
  });

  it("takes the folded row's line from the pane it speaks for", () => {
    const view = buildAgentRail({
      ...railInput({
        tabs: [
          tab(1, "/w/deck", {
            name: "review",
            panes: [
              pane(101, { agent: "codex", phase: "working" }),
              pane(102, { agent: "claude", attention: "error" }),
            ],
          }),
        ],
      }),
      // Only the loudest pane's tail reaches the tab row; every pane keeps
      // its own.
      tails: new Map([
        [101, "Running the suite"],
        [102, "Cannot reach the daemon"],
      ]),
    });

    const row = streamRows(view)[0];
    expect(row.message).toBe("Cannot reach the daemon");
    expect(row.panes.map((entry) => entry.message)).toEqual([
      "Running the suite",
      "Cannot reach the daemon",
    ]);
  });

  it("reads the tail per pane, not per tab", () => {
    const view = buildAgentRail({
      ...railInput({
        tabs: [
          tab(1, "/w/deck", {
            name: "review",
            panes: [pane(101, { agent: "codex" }), pane(102, { agent: "claude" })],
          }),
        ],
      }),
      tails: new Map([[102, "Wrote the migration"]]),
    });

    expect(streamRows(view)[0].panes.map((entry) => entry.message)).toEqual([
      "",
      "Wrote the migration",
    ]);
  });
});

describe("tabTail", () => {
  // The tab strip prints this too (DL-18.10, amended 2026-08-17), so the
  // question "which pane speaks for this tab" is answered once.
  it("quotes the pane the rail row would speak for", () => {
    const view = tab(1, "/w/deck", {
      panes: [
        pane(101, { agent: "codex", phase: "working" }),
        pane(102, { agent: "claude", attention: "error" }),
      ],
    });

    expect(
      tabTail(
        view,
        new Map([
          [101, "Running the suite"],
          [102, "Cannot reach the daemon"],
        ]),
      ),
    ).toBe("Cannot reach the daemon");
  });

  it("is empty for a tab with no tail, no agent pane, or no tab at all", () => {
    const spoken = tab(1, "/w/deck", { panes: [pane(101)] });
    const shellOnly = tab(2, "/w/deck", {
      panes: [pane(102, { agent: null })],
    });

    expect(tabTail(spoken, new Map())).toBe("");
    expect(tabTail(spoken, undefined)).toBe("");
    expect(tabTail(shellOnly, new Map([[102, "not an agent"]]))).toBe("");
    expect(tabTail(undefined, new Map([[101, "orphan"]]))).toBe("");
  });
});

describe("buildAgentRail remembered projects (2026-08-20)", () => {
  it("keeps a cluster for a history workspace with no open tab, with its checkout as a rowless group", () => {
    const view = buildAgentRail(railInput({ tabs: [], workspaceHistoryPaths: ["/w/deck"] }));

    expect(view.stream).toEqual([
      {
        key: "remembered:/w/deck/.git",
        // Un-prefixed: the identity the live tier stores this project under.
        orderKey: "/w/deck/.git",
        tabIndexes: [],
        project: "deck",
        labelled: true,
        // `rail-create-consolidation` (2026-09-02): was `[]` — the header's own
        // `+` was the way back in. With that control gone the remembered
        // checkout is a group with nothing open, the same shape a history-only
        // sibling of a live project has always had, so its bare row is the
        // create control.
        worktrees: [
          {
            key: "/w/deck",
            branch: "main",
            name: "deck",
            path: "/w/deck",
            repositoryPath: "/w/deck",
            primary: true,
            labelled: true,
            entries: [],
            panes: [],
            rows: [],
            live: false,
            age: "",
            active: false,
          },
        ],
        path: "/w/deck",
        // Every history entry the header folds, so its close control can
        // forget all of them at once.
        historyPaths: ["/w/deck"],
      },
    ]);
  });

  it("prints every remembered checkout of a repository as a rowless group, primary first", () => {
    const view = buildAgentRail(
      railInput({ tabs: [], workspaceHistoryPaths: ["/w/deck-side", "/w/deck"] }),
    );

    // One header (folded by the scan), two groups, and the primary leads
    // whatever order the history had — `sortWorktrees`' rule one tier up.
    expect(view.stream).toHaveLength(1);
    expect(
      view.stream[0].worktrees.map((worktree) => [
        worktree.path,
        worktree.primary,
        worktree.branch,
      ]),
    ).toEqual([
      ["/w/deck", true, "main"],
      ["/w/deck-side", false, "release-hardening"],
    ]);
    expect(view.stream[0].historyPaths).toEqual(["/w/deck-side", "/w/deck"]);
  });

  it("folds several remembered worktrees of one repository into one cluster", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [],
        workspaceHistoryPaths: ["/w/deck-side", "/w/deck"],
      }),
    );

    // Named after the repository's own checkout, and the `+` opens into the
    // newest history entry.
    expect(view.stream.map((group) => [group.project, group.path])).toEqual([
      ["deck", "/w/deck-side"],
    ]);
  });

  it("never repeats a live project, and lists live work first", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        workspaceHistoryPaths: ["/w/deck", "/w/scratch"],
      }),
    );

    expect(view.stream.map((group) => [group.project, clusterRows(group).length])).toEqual([
      ["deck", 1],
      ["scratch", 0],
    ]);
    expect(view.stream[0].path).toBeNull();
  });

  it("names a remembered folder git does not know by its basename", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [],
        scans: new Map(),
        workspaceHistoryPaths: ["/home/me/scratch"],
      }),
    );

    expect(view.stream).toEqual([
      {
        key: "remembered:plain:/home/me/scratch",
        orderKey: "plain:/home/me/scratch",
        tabIndexes: [],
        project: "scratch",
        labelled: true,
        // One synthetic, unlabelled checkout named after the folder — the
        // shape `buildRail` gives a live plain folder (`branch` falls back to
        // the basename there too), so it renders as flat entries plus that
        // tier's `New agent` row.
        worktrees: [
          {
            key: "/home/me/scratch",
            branch: "scratch",
            name: "scratch",
            path: "/home/me/scratch",
            repositoryPath: "/home/me/scratch",
            primary: true,
            labelled: false,
            entries: [],
            panes: [],
            rows: [],
            live: false,
            age: "",
            active: false,
          },
        ],
        path: "/home/me/scratch",
        historyPaths: ["/home/me/scratch"],
      },
    ]);
  });

  it("attaches a remembered subdirectory of a live worktree to the live cluster", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        workspaceHistoryPaths: ["/w/deck/packages/web"],
      }),
    );

    // Longest-prefix, the same attachment rule tabs use: no second cluster.
    expect(view.stream.map((group) => group.project)).toEqual(["deck"]);
  });
});

describe("buildAgentRail manual order (2026-08-22)", () => {
  it("gives one project the same orderKey in both tiers", () => {
    const withTab = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        workspaceHistoryPaths: ["/w/deck"],
      }),
    );
    const afterClose = buildAgentRail(railInput({ tabs: [], workspaceHistoryPaths: ["/w/deck"] }));

    // `key` moves with the tier; `orderKey` is what the stored order is
    // written against, and it does not (spec §3).
    expect(withTab.stream[0].key).not.toBe(afterClose.stream[0].key);
    expect(withTab.stream[0].orderKey).toBe("/w/deck/.git");
    expect(afterClose.stream[0].orderKey).toBe("/w/deck/.git");
  });

  it("leaves the stream untouched when no project has been dragged", () => {
    const input = railInput({
      tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
      workspaceHistoryPaths: ["/w/deck", "/w/scratch"],
      scans: new Map([...DECK_SCANS]),
    });

    expect(buildAgentRail({ ...input, railOrder: [] })).toEqual(buildAgentRail(input));
  });

  it("puts a pinned project above live work even when it is only remembered", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        workspaceHistoryPaths: ["/w/deck", "/home/me/scratch"],
        railOrder: ["plain:/home/me/scratch"],
      }),
    );

    // The live/remembered boundary does not apply to a pinned cluster: the
    // owner asked for a position, not a position within a tier (spec §4).
    expect(view.stream.map((group) => group.project)).toEqual(["scratch", "deck"]);
  });
});

describe("buildAgentRail — what a live cluster's close has to take (close model, 2026-08-22)", () => {
  it("lists every tab of the project, secondary worktrees included, ascending", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck-side", { panes: [pane(1)] }),
          tab(2, "/w/deck", { panes: [pane(2)] }),
        ],
      }),
    );

    expect(view.stream).toHaveLength(1);
    // Ascending by INDEX, whatever order the rows are drawn in: the caller
    // disposes from the back, where a removal cannot shift a coordinate it has
    // not used yet.
    expect(view.stream[0].tabIndexes).toEqual([0, 1]);
  });

  it("claims the history entries that would otherwise re-derive the header", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        // `/w/deck-side` is a worktree of the SAME repository with nothing open
        // in it — not prefix-attached to any live path, so without the key rule
        // it would build its own remembered cluster under this project's own
        // `orderKey` and the header would come straight back.
        workspaceHistoryPaths: ["/w/deck", "/w/deck-side"],
      }),
    );

    expect(view.stream[0].historyPaths).toEqual(["/w/deck", "/w/deck-side"]);
  });

  it("leaves another project's history alone", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        workspaceHistoryPaths: ["/w/deck", "/home/me/scratch"],
      }),
    );

    const live = view.stream.find((group) => group.orderKey === "/w/deck/.git");
    expect(live?.historyPaths).toEqual(["/w/deck"]);
    // The unrelated folder is still its own remembered cluster.
    expect(view.stream.map((group) => group.orderKey)).toContain("plain:/home/me/scratch");
  });

  it("gives a remembered cluster no tab to close", () => {
    const view = buildAgentRail(railInput({ tabs: [], workspaceHistoryPaths: ["/w/deck"] }));

    // No rows anywhere under it — its checkout prints as a rowless group since
    // `rail-create-consolidation` — so the close has nothing to close and only
    // forgets. `tabIndexes`, not `worktrees.length`, is what says "live".
    expect(view.stream[0].worktrees.map((worktree) => [worktree.path, worktree.rows])).toEqual([
      ["/w/deck", []],
    ]);
    expect(view.stream[0].tabIndexes).toEqual([]);
    expect(view.stream[0].historyPaths).toEqual(["/w/deck"]);
  });
});

describe("buildAgentRail focused pane (DL-27.22)", () => {
  it("marks the focused pane of the active tab and nothing else", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", {
            panes: [pane(1, { focused: false }), pane(2, { focused: true })],
          }),
          // A second tab has a focused pane of its own — every tab does — and
          // reporting it would light one row per tab.
          tab(2, "/w/deck", { panes: [pane(3, { focused: true })] }),
        ],
        activeIndex: 0,
      }),
    );

    const focused = streamRows(view).flatMap((row) =>
      row.panes.filter((p) => p.focused).map((p) => p.paneId),
    );
    expect(focused).toEqual([2]);
  });

  it("marks nothing while no tab is active", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1, { focused: true })] })],
        activeIndex: -1,
      }),
    );

    expect(
      streamRows(view)
        .flatMap((row) => row.panes)
        .map((p) => p.focused),
    ).toEqual([false]);
  });

  it("marks nothing for a pane view that predates the field", () => {
    const view = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/deck", { panes: [pane(1)] })], activeIndex: 0 }),
    );

    expect(streamRows(view)[0].panes[0].focused).toBe(false);
  });
});

describe("stripSegments (Task 5, 2026-08-26)", () => {
  /** Minimal RailCardPane fixture with the fields stripSegments reads. */
  function cardPane(paneId: number, state: RailCardPane["state"], changedAt: number): RailCardPane {
    return {
      kind: "agent",
      paneId,
      agent: "claude",
      focused: false,
      message: "",
      age: "",
      state,
      changedAt,
      tabIndex: 0,
      model: "",
      label: "Claude",
    };
  }

  const idle = cardPane(1, "idle", NOW - 5 * MINUTE);
  const working = cardPane(2, "working", NOW - 3 * MINUTE);
  const failed = cardPane(3, "failed", NOW - MINUTE);
  const asked = cardPane(4, "asked", NOW - 2 * MINUTE);
  const done = cardPane(5, "done", NOW - 4 * MINUTE);

  it("shows the three loudest panes and counts the rest", () => {
    const panes = [idle, working, failed, asked, done];
    const { shown, overflow } = stripSegments(panes);
    expect(shown.map((p) => p.state)).toEqual(["failed", "asked", "working"]);
    expect(overflow).toBe(2);
  });

  it("breaks an equal-state tie by changedAt, newest first", () => {
    // pins `outranks`' actual rule, so a later reader does not assume open order
    const olderWorking = cardPane(1, "working", NOW - 10 * MINUTE);
    const newerWorking = cardPane(2, "working", NOW - MINUTE);
    const { shown } = stripSegments([olderWorking, newerWorking]);
    expect(shown[0].paneId).toBe(2); // newer wins
    expect(shown[1].paneId).toBe(1);
  });

  it("returns all panes when there are fewer than STRIP_VISIBLE", () => {
    const { shown, overflow } = stripSegments([failed, asked]);
    expect(shown.length).toBe(2);
    expect(overflow).toBe(0);
  });

  it("returns an empty strip and zero overflow for no panes", () => {
    const { shown, overflow } = stripSegments([]);
    expect(shown).toEqual([]);
    expect(overflow).toBe(0);
  });

  it("does not mutate the input array (C1)", () => {
    const panes = [idle, working, failed, asked, done];
    const originalOrder = panes.map((p) => p.paneId);
    stripSegments(panes);
    expect(panes.map((p) => p.paneId)).toEqual(originalOrder);
  });

  it("STRIP_VISIBLE is 3", () => {
    expect(STRIP_VISIBLE).toBe(3);
  });
});
