import { describe, expect, it } from "vitest";
import type { PaneView } from "../terminal/tabs-store";
import type { AgentRailView } from "./agent-rail-model";
import {
  API_KEY,
  DECK_KEY,
  ids,
  layout,
  MINUTE,
  NOTES_KEY,
  NOW,
  pane,
  rail,
  tab,
  twinRail,
  viewOf,
  WORKDAY,
} from "./rail-view-fixtures";
import { fuzzyMatch, railItems, railStatus, type RailViewModel } from "./rail-view-model";

describe("railStatus: asked split by what it waits for (LAY-4)", () => {
  it("splits a question or warning from a finished run, each keeping its confidence", () => {
    const view = rail([
      tab(1, "/w/deck", [
        pane(1, { attention: "requested", confidence: "explicit" }),
        pane(2, { attention: "warning", confidence: "explicit" }),
        pane(3, { attention: "completed", confidence: "inferred" }),
        pane(4, { attention: "completed", confidence: "explicit" }),
      ]),
    ]);
    expect(railItems(view).map((item) => [item.status, item.confidence])).toEqual([
      ["needs-input", "explicit"],
      ["needs-input", "explicit"],
      ["unread", "inferred"],
      ["unread", "explicit"],
    ]);
    // The shipped rail still folds all four into one word and one mark.
    expect(view.stream[0].worktrees[0].rows[0].panes.map((row) => row.state)).toEqual([
      "asked",
      "asked",
      "asked",
      "asked",
    ]);
  });

  it("passes every other state through", () => {
    const view = rail([
      tab(1, "/w/deck", [
        pane(1, { attention: "error" }),
        pane(2, { phase: "exited" }),
        pane(3, { phase: "working" }),
        pane(4),
        pane(5, { hasRun: false }),
      ]),
    ]);
    expect(railItems(view).map((item) => item.status)).toEqual([
      "failed",
      "ended",
      "working",
      "done",
      "idle",
    ]);
  });

  it("reads an asked row that carries no attention as a question, never as quiet", () => {
    expect(railStatus({ state: "asked" })).toBe("needs-input");
  });
});

describe("railItems", () => {
  it("makes one row per agent pane and per agent-less tab, titled and placed per LAY-2", () => {
    expect(
      railItems(WORKDAY).map((item) => [item.id, item.title, item.branch, item.projectKey]),
    ).toEqual([
      ["pane:11", "Which migration should run first?", "main", DECK_KEY],
      // Silent and unnamed: the agent's own name.
      ["pane:12", "Claude", "main", DECK_KEY],
      ["pane:21", "Token refresh is fixed", "release-hardening", DECK_KEY],
      // The user's tab name outranks anything the agent said.
      ["pane:31", "auth handoff", "api", API_KEY],
      // A folder git does not know: its own name stands in for the branch.
      ["shell:4", "Shell", "api", API_KEY],
    ]);
  });
});

describe("project roll-up (LAY-1)", () => {
  const LOUD = {
    failed: { attention: "error" },
    needs: { attention: "requested" },
    working: { phase: "working" },
    unread: { attention: "completed" },
  } as const;

  function rollupOf(...panes: readonly Partial<PaneView>[]) {
    const view = rail([
      tab(
        1,
        "/w/deck",
        panes.map((over, at) => pane(at + 1, over)),
      ),
    ]);
    return viewOf({}, view).groups[0].rollup?.status ?? null;
  }

  it("speaks with the loudest row: failed, needs input, working, then unread", () => {
    expect(rollupOf(LOUD.unread, LOUD.working, LOUD.needs, LOUD.failed)).toBe("failed");
    expect(rollupOf(LOUD.unread, LOUD.working, LOUD.needs)).toBe("needs-input");
    expect(rollupOf(LOUD.unread, LOUD.working)).toBe("working");
    expect(rollupOf(LOUD.unread)).toBe("unread");
  });

  it("is null for a quiet project", () => {
    expect(rollupOf({ phase: "exited" }, {}, { hasRun: false })).toBeNull();
  });

  it("takes the newest of two equally loud rows", () => {
    const view = rail([
      tab(1, "/w/deck", [
        pane(1, { attention: "requested", changedAt: NOW - 9 * MINUTE }),
        pane(2, { attention: "requested", changedAt: NOW - 2 * MINUTE }),
      ]),
    ]);
    expect(viewOf({}, view).groups[0].rollup?.id).toBe("pane:2");
  });

  it("leaves archived rows out of the roll-up and the count", () => {
    const api = (model: RailViewModel) => model.groups.find((group) => group.key === API_KEY);
    expect(api(viewOf())).toMatchObject({ count: 2, rollup: { id: "pane:31" } });
    expect(api(viewOf({ archived: new Set(["pane:31"]) }))).toMatchObject({
      count: 1,
      rollup: null,
    });
  });
});

describe("grouping", () => {
  it("by project: every shown project in stream order, newest row first", () => {
    const model = viewOf();
    expect(layout(model)).toEqual([
      [DECK_KEY, ["pane:12", "pane:21", "pane:11"]],
      [API_KEY, ["pane:31", "shell:4"]],
      // Remembered, nothing open: still a project the rail lists.
      [NOTES_KEY, []],
    ]);
    expect(model.groups.map((group) => [group.label, group.count])).toEqual([
      ["deck", 3],
      ["api", 2],
      ["notes", 0],
    ]);
  });

  it("by status: Needs you, Unread, Working, Quiet, empty buckets left out", () => {
    const model = viewOf({ grouping: "status" });
    expect(model.groups.map((group) => [group.label, ids(group.items)])).toEqual([
      ["Needs you", ["pane:11", "pane:31"]],
      ["Unread", ["pane:21"]],
      ["Working", ["pane:12"]],
      ["Quiet", ["shell:4"]],
    ]);
    expect(model.groups.every((group) => group.rollup === null)).toBe(true);
  });

  it("by time: time in state, a row never seen to change in Earlier", () => {
    const model = viewOf({ grouping: "time" });
    expect(model.groups.map((group) => [group.label, ids(group.items), group.count])).toEqual([
      ["Last 5 minutes", ["pane:12", "pane:21"], 2],
      ["Last 15 minutes", ["pane:11"], 1],
      ["Earlier", ["pane:31", "shell:4"], 2],
    ]);
  });
});

describe("order", () => {
  it("sorts loudest first under Priority", () => {
    expect(layout(viewOf({ sorting: "priority" }))[0]).toEqual([
      DECK_KEY,
      ["pane:11", "pane:12", "pane:21"],
    ]);
  });

  it("keeps stream order on a tie, and the same order on every call", () => {
    const view = rail([tab(1, "/w/deck", [pane(3), pane(1), pane(2)])]);
    expect(layout(viewOf({}, view))[0]).toEqual([DECK_KEY, ["pane:3", "pane:1", "pane:2"]]);
    expect(layout(viewOf({}, view))).toEqual(layout(viewOf({}, view)));
  });

  it("never moves a project when its agents change state", () => {
    const quiet = rail([tab(1, "/w/deck", [pane(1)]), tab(2, "/w/api", [pane(2)])]);
    const loud = rail([
      tab(1, "/w/deck", [pane(1)]),
      tab(2, "/w/api", [pane(2, { attention: "error", changedAt: NOW })]),
    ]);
    for (const sorting of ["updated", "priority"] as const) {
      const keys = (view: AgentRailView) =>
        viewOf({ sorting }, view).groups.map((group) => group.key);
      expect(keys(loud)).toEqual(keys(quiet));
    }
  });
});

describe("search", () => {
  it("matches a case-insensitive subsequence, whitespace ignored", () => {
    expect(fuzzyMatch("tkrf", "token refresh")).toBe(true);
    expect(fuzzyMatch("TK rf", "Token Refresh")).toBe(true);
    expect(fuzzyMatch("fkt", "token refresh")).toBe(false);
    expect(fuzzyMatch("  ", "anything")).toBe(true);
  });

  it("searches title, branch and project, dropping a project with no match", () => {
    expect(layout(viewOf({ query: "migration" }))).toEqual([[DECK_KEY, ["pane:11"]]]);
    expect(layout(viewOf({ query: "release" }))).toEqual([[DECK_KEY, ["pane:21"]]]);
    expect(layout(viewOf({ query: "api" }))).toEqual([[API_KEY, ["pane:31", "shell:4"]]]);
    expect(layout(viewOf({ query: "api", grouping: "status" }))).toEqual([
      ["needs-you", ["pane:31"]],
      ["quiet", ["shell:4"]],
    ]);
  });
});

describe("review follow-ups", () => {
  it("lists a repository with two stream groups under one key once, each row once", () => {
    const view = twinRail();
    // The precondition the fixture exists for: the stream really carries a twin.
    expect(view.stream.map((group) => group.orderKey)).toEqual([DECK_KEY, DECK_KEY]);
    const model = viewOf({}, view);
    expect(layout(model)).toEqual([[DECK_KEY, ["pane:11"]]]);
    expect(model.groups[0]).toMatchObject({ count: 1, rollup: { id: "pane:11" } });
    expect(viewOf({ hidden: new Set([DECK_KEY]) }, view).hidden.map((p) => p.key)).toEqual([
      DECK_KEY,
    ]);
  });

  it.each(["status", "time"] as const)(
    "puts every unarchived row in exactly one %s bucket",
    (grouping) => {
      const view = rail([
        tab(1, "/w/deck", [
          pane(1, { attention: "error", changedAt: NOW - MINUTE }),
          pane(2, { attention: "requested", changedAt: NOW - 5 * MINUTE }),
          pane(3, { attention: "completed", changedAt: NOW - 15 * MINUTE }),
          pane(4, { phase: "exited", changedAt: NOW - 20 * MINUTE }),
          pane(5, { phase: "working", changedAt: NOW + 1 }),
          pane(6),
          pane(7, { hasRun: false }),
        ]),
        tab(2, "/w/api", [pane(8, { agent: null })]),
      ]);
      const archived = new Set(["pane:6"]);
      const placed = viewOf({ grouping, archived }, view).groups.flatMap((group) =>
        ids(group.items),
      );
      const expected = ids(railItems(view)).filter((id) => !archived.has(id));
      expect([...placed].sort()).toEqual([...expected].sort());
    },
  );

  it("starts a time bucket at its bound: 5 minutes is no longer the last 5", () => {
    const view = rail([
      tab(1, "/w/deck", [
        pane(1, { changedAt: NOW - 5 * MINUTE }),
        pane(2, { changedAt: NOW - 15 * MINUTE }),
        // A clock that ran behind the pane's change counts as no time at all.
        pane(3, { changedAt: NOW + 1 }),
      ]),
    ]);
    expect(layout(viewOf({ grouping: "time" }, view))).toEqual([
      ["last-5m", ["pane:3"]],
      ["last-15m", ["pane:1"]],
      ["earlier", ["pane:2"]],
    ]);
  });

  it("matches a row through its project name alone", () => {
    // No title or branch in deck holds d-e-c-k in order; the project does.
    expect(layout(viewOf({ query: "deck" }))).toEqual([
      [DECK_KEY, ["pane:12", "pane:21", "pane:11"]],
    ]);
  });

  it("keeps a project's count and roll-up whole under a search, and Archived unfiltered", () => {
    const model = viewOf({ query: "release", archived: new Set(["pane:31"]) });
    expect(layout(model)).toEqual([[DECK_KEY, ["pane:21"]]]);
    // The roll-up is the loudest of the project, not of what the search left.
    expect(model.groups[0]).toMatchObject({ count: 3, rollup: { id: "pane:11" } });
    expect(ids(model.archived)).toEqual(["pane:31"]);
  });

  it("titles a silent row by the session's first prompt, else by an ordinal agent name", () => {
    const view = rail(
      [tab(1, "/w/deck", [pane(1), pane(2)]), tab(2, "/w/api", [pane(3)])],
      new Map(),
      new Map([[3, "Fix the login flow"]]),
    );
    expect(railItems(view).map((item) => [item.id, item.title])).toEqual([
      ["pane:1", "Claude"],
      ["pane:2", "Claude 2"],
      ["pane:3", "Fix the login flow"],
    ]);
  });
});
