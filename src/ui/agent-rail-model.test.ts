import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView, TabView } from "../terminal/tabs-store";
import {
  type AgentRailInput,
  type AgentRailView,
  buildAgentRail,
  formatShortAge,
  tabTail,
} from "./agent-rail-model";

/** The stream's rows in render order, flattened out of their clusters. */
function streamRows(view: AgentRailView) {
  return view.stream.flatMap((group) => group.rows);
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
    archivedPaths: new Set(),
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
  it("names the project, and the worktree only outside the primary checkout", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [
          tab(1, "/w/deck", { panes: [pane(1)] }),
          tab(2, "/w/deck-side", { panes: [pane(2)] }),
        ],
      }),
    );

    // Open order, so the primary checkout's row comes first and carries no
    // suffix; the second worktree's row names its branch.
    expect(streamRows(view).map((row) => [row.project, row.worktree])).toEqual([
      ["deck", null],
      ["deck", "release-hardening"],
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

    expect(streamRows(view)[0]).toMatchObject({
      project: "scratch",
      worktree: null,
    });
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

    expect(view.stream.map((group) => [group.project, group.labelled, group.rows.length])).toEqual([
      // Deck was opened first, so its cluster leads. Both projects keep the
      // same project → tab hierarchy regardless of their tab count.
      ["deck", true, 2],
      ["api", true, 1],
    ]);
    // Inside a cluster the rows keep the order they were opened in.
    expect(view.stream[0].rows.map((row) => row.key)).toEqual([1, 2]);
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

    // One project, printed once, with all three of its tabs under it.
    expect(view.stream).toHaveLength(1);
    expect(view.stream[0].labelled).toBe(true);
    expect(view.stream[0].rows.map((row) => row.key)).toEqual([1, 2, 3]);
    expect(view.stream[0].rows[0].state).toBe("asked");
  });

  it("keeps a project whose only tab wants the user", () => {
    const view = buildAgentRail(
      twoProjects({
        tabs: [tab(1, "/w/deck", { panes: [pane(1, { attention: "error" })] })],
      }),
    );

    expect(view.stream.map((group) => [group.project, group.labelled])).toEqual([["deck", true]]);
    expect(view.stream[0].rows[0].state).toBe("failed");
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

  it("drops a message line that repeats a worktree name", () => {
    const view = buildAgentRail(
      railInput({ tabs: [tab(1, "/w/deck-side", { panes: [pane(1)] })] }),
    );

    expect(streamRows(view)[0]).toMatchObject({
      worktree: "release-hardening",
      message: "",
    });
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

describe("buildAgentRail archived rows", () => {
  it("resumes a previously opened worktree with no live tab", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        archivedPaths: new Set(["/w/deck-side"]),
      }),
    );

    expect(view.archived).toEqual([
      { path: "/w/deck-side", project: "deck", worktree: "release-hardening" },
    ]);
  });

  it("leaves the worktree suffix off an archived primary checkout", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck-side", { panes: [pane(1)] })],
        archivedPaths: new Set(["/w/deck"]),
      }),
    );

    expect(view.archived).toEqual([{ path: "/w/deck", project: "deck", worktree: null }]);
  });

  it("never lists a worktree that already has a live tab", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        archivedPaths: new Set(["/w/deck", "/w/deck-side"]),
      }),
    );

    expect(view.archived.map((row) => row.path)).toEqual(["/w/deck-side"]);
  });

  it("does not invent a row for a never-opened sibling worktree", () => {
    // Git discovery supplies metadata; Deck's own history decides which
    // checkout becomes navigation.
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        archivedPaths: new Set(["/w/deck-side"]),
        workspaceHistoryPaths: ["/w/deck"],
      }),
    );

    expect(view.archived).toEqual([]);
  });

  it("leaves an empty worktree with no archived session alone", () => {
    const view = buildAgentRail(railInput({ tabs: [tab(1, "/w/deck", { panes: [pane(1)] })] }));

    expect(view.archived).toEqual([]);
  });

  it("orders archived rows newest first, matching subdirectory history", () => {
    const scan = repo("/w/deck/.git", [
      { path: "/w/deck", branch: "main" },
      { path: "/w/deck-side", branch: "release-hardening" },
      { path: "/w/deck-third", branch: "usage-dashboard" },
    ]);
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        scans: new Map([["/w/deck", scan]]),
        archivedPaths: new Set(["/w/deck-side", "/w/deck-third"]),
        // Newest first, and the newest entry was recorded on a package below
        // the worktree root — the same prefix match the rail filter uses.
        workspaceHistoryPaths: ["/w/deck-third/packages/web", "/w/deck-side", "/w/deck"],
      }),
    );

    expect(view.archived.map((row) => row.path)).toEqual(["/w/deck-third", "/w/deck-side"]);
  });

  it("lights up a worktree from an archive entry recorded on a subdirectory", () => {
    const view = buildAgentRail(
      railInput({
        tabs: [tab(1, "/w/deck", { panes: [pane(1)] })],
        archivedPaths: new Set(["/w/deck-side/packages/web"]),
      }),
    );

    expect(view.archived.map((row) => row.path)).toEqual(["/w/deck-side"]);
  });
});
