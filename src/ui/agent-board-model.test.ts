import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView, TabView } from "../terminal/tabs-store";
import {
  boardWhere,
  buildAgentBoard,
  cardForDigit,
  type AgentBoardInput,
} from "./agent-board-model";

const HOME = "/Users/deck";
// The cluster's project word is the primary checkout's BASENAME
// (`repository-model.ts`, `workspaceLabel(entries[0].path)`), not the scan
// key — so the fixture's basename is the word the assertions expect.
const DECK = `${HOME}/deck`;
const DECK_FIX = `${HOME}/deck-worktrees/fix-rail`;
const SCRATCH = `${HOME}/scratch`;

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
const SCANS = new Map<string, RepositoryScan>([
  [
    DECK,
    repo("deck", [
      { path: DECK, branch: "main" },
      { path: DECK_FIX, branch: "fix/rail" },
    ]),
  ],
  [
    DECK_FIX,
    repo("deck", [
      { path: DECK, branch: "main" },
      { path: DECK_FIX, branch: "fix/rail" },
    ]),
  ],
  [SCRATCH, { kind: "plain", reason: "not a repository" }],
]);

function pane(
  paneId: number,
  agent: string | null,
  attention: PaneView["attention"],
  phase: PaneView["phase"],
  hasRun = false,
): PaneView {
  return { paneId, agent, attention, phase, hasRun, changedAt: 1_000, focused: false };
}
function tab(
  key: number,
  workspacePath: string,
  panes: readonly PaneView[],
  name: string | null = null,
): TabView {
  return {
    key,
    process: panes[0]?.agent ?? "zsh",
    name,
    dotColor: null,
    workspacePath,
    agents: panes.flatMap((p) => (p.agent ? [p.agent] : [])),
    agentBusy: false,
    unread: false,
    panes,
  };
}
function input(over: Partial<AgentBoardInput> = {}): AgentBoardInput {
  return {
    tabs: [
      tab(1, DECK, [pane(11, "claude", "none", "working", true)]),
      tab(
        2,
        DECK,
        [pane(21, "codex", "completed", "idle", true), pane(22, "claude", "none", "idle", true)],
        "api",
      ),
      tab(3, DECK_FIX, [pane(31, "opencode", "none", "idle", false)]),
      tab(4, SCRATCH, [pane(41, "gemini", "error", "idle", true)]),
      tab(5, DECK, [pane(51, null, "completed", "idle", true)]),
    ],
    activeIndex: 0,
    scans: SCANS,
    workspaceHistoryPaths: [DECK, DECK_FIX, SCRATCH],
    tails: new Map([
      [11, "Reading the rail model"],
      [22, "Done with the tests"],
    ]),
    ordinals: new Map([
      [11, 3],
      [21, 1],
      [22, 2],
      [31, 5],
      [41, 4],
      [51, 6],
    ]),
    // Never 0: `formatShortAge` reads a 0 timestamp as "never" and prints "".
    startedAt: new Map([
      [11, 1],
      [21, 1],
    ]),
    tasks: new Map([
      [11, "Refactor the rail model\nsecond line"],
      [31, "Never ran"],
    ]),
    lastAgents: new Map([[51, "claude"]]),
    confidence: new Map([
      [11, "explicit"],
      [21, "inferred"],
    ]),
    home: HOME,
    now: 600_001,
    selectedPaneId: null,
    statusFilter: "all",
    projectFilter: null,
    heldOrder: null,
    ...over,
  };
}

describe("buildAgentBoard — cards", () => {
  it("makes one card per agent pane plus one per departed pane, ranked by ordinal", () => {
    const view = buildAgentBoard(input());
    expect(view.all.map((c) => [c.paneId, c.rank])).toEqual([
      [21, 1],
      [22, 2],
      [11, 3],
      [41, 4],
      [31, 5],
      [51, 6],
    ]);
    expect(view.total).toBe(6);
  });
  it("sorts loudest first, then by ordinal, and forces a departed card to idle", () => {
    const view = buildAgentBoard(input());
    expect(view.cards.map((c) => `${c.paneId}:${c.state}`)).toEqual([
      "41:failed",
      "21:asked",
      "11:working",
      "22:done",
      "31:idle",
      "51:idle",
    ]);
    expect(view.cards[5].departed).toBe(true);
    expect(view.cards[5].agent).toBe("claude");
  });
  it("keeps one restartable card when an ended agent retains its label", () => {
    const shared = {
      ordinals: new Map([[11, 3]]),
      lastAgents: new Map([[11, "claude"]]),
    };
    for (const agent of ["claude", null]) {
      const view = buildAgentBoard(
        input({
          ...shared,
          tabs: [tab(1, DECK, [pane(11, agent, "none", "exited", true)])],
        }),
      );
      expect(view.cards).toHaveLength(1);
      expect(view.cards[0]).toMatchObject({
        agent: "claude",
        departed: true,
        state: "idle",
        ordinal: 3,
      });
    }
  });
  it("names a single-agent tab by its custom name and a multi-agent tab by the agent, moving the tab name to where", () => {
    const view = buildAgentBoard(
      input({
        tabs: [tab(2, DECK, [pane(21, "codex", "none", "idle", true)], "api")],
        ordinals: new Map([[21, 1]]),
      }),
    );
    expect(view.all[0].name).toBe("api");
    expect(view.all[0].where).toBe("deck · main");
    expect(view.all[0].project).toBe("deck");
    const multi = buildAgentBoard(input());
    const codex = multi.all.find((c) => c.paneId === 21)!;
    expect(codex.name).toBe("Codex");
    expect(codex.where).toBe("deck · main · api");
  });
  it("prints a worktree as project · name · branch and a plain folder as its ~ path", () => {
    const view = buildAgentBoard(input());
    expect(view.all.find((c) => c.paneId === 31)!.where).toBe("deck · fix-rail · fix/rail");
    expect(view.all.find((c) => c.paneId === 31)!.project).toBe("deck");
    expect(view.all.find((c) => c.paneId === 41)!.where).toBe("~/scratch");
  });
  it("prefers the task once the pane has reached working, else the tail, else nothing", () => {
    const view = buildAgentBoard(input());
    const byId = (id: number) => view.all.find((c) => c.paneId === id)!;
    expect(byId(11).what).toEqual({ kind: "task", text: "Refactor the rail model" });
    expect(byId(31).what).toEqual({ kind: "none", text: "" });
    expect(byId(22).what).toEqual({ kind: "tail", text: "Done with the tests" });
    expect(byId(11).task).toBe("Refactor the rail model\nsecond line");
  });
  it("formats uptime from startedAt and changed from changedAt, empty when unknown", () => {
    const view = buildAgentBoard(input());
    expect(view.all.find((c) => c.paneId === 11)!.up).toBe("10m");
    expect(view.all.find((c) => c.paneId === 31)!.up).toBe("");
    expect(view.all.find((c) => c.paneId === 11)!.changed).toBe("9m");
  });
  it("carries confidence when known", () => {
    const view = buildAgentBoard(input());
    expect(view.all.find((c) => c.paneId === 21)!.confidence).toBe("inferred");
    expect(view.all.find((c) => c.paneId === 31)!.confidence).toBeNull();
  });
});

describe("buildAgentBoard — nav and filters", () => {
  it("counts totals per state, omits Failed while nothing is failed, and includes it otherwise", () => {
    const view = buildAgentBoard(input());
    expect(view.status.map((r) => `${r.label}:${r.count}`)).toEqual([
      "All:6",
      "Failed:1",
      "Asked:1",
      "Working:1",
      "Done:1",
      "Idle:2",
    ]);
    const calm = buildAgentBoard(
      input({
        tabs: [tab(1, DECK, [pane(11, "claude", "none", "working", true)])],
        ordinals: new Map([[11, 1]]),
      }),
    );
    expect(calm.status.map((r) => r.label)).toEqual(["All", "Asked", "Working", "Done", "Idle"]);
  });
  it("keeps the Failed row at zero while it is the active filter, so a recovered pane cannot strand the user", () => {
    const view = buildAgentBoard(
      input({
        tabs: [tab(1, DECK, [pane(11, "claude", "none", "working", true)])],
        ordinals: new Map([[11, 1]]),
        statusFilter: "failed",
      }),
    );
    expect(view.status.map((r) => `${r.label}:${r.count}:${r.active}`)).toEqual([
      "All:1:false",
      "Failed:0:true",
      "Asked:0:false",
      "Working:1:false",
      "Done:0:false",
      "Idle:0:false",
    ]);
    expect(view.cards).toEqual([]);
  });
  it("lists one PROJECTS row per checkout holding a card, in the rail's order, with card counts", () => {
    const view = buildAgentBoard(input());
    expect(view.projects.map((r) => `${r.label}=${r.count}`)).toEqual([
      "deck · main=4",
      "deck · fix-rail · fix/rail=1",
      "~/scratch=1",
    ]);
  });
  it("filters by status and by project without changing totals or ranks", () => {
    const view = buildAgentBoard(input({ statusFilter: "idle" }));
    expect(view.cards.map((c) => c.paneId)).toEqual([31, 51]);
    expect(view.total).toBe(6);
    expect(view.shown).toBe(2);
    const project = buildAgentBoard(input({ projectFilter: view.projects[1].key }));
    expect(project.cards.map((c) => c.paneId)).toEqual([31]);
    expect(project.status[0].count).toBe(6);
  });
  it("holds the order while a panel is open and appends newcomers", () => {
    const held = buildAgentBoard(
      input({ selectedPaneId: 22, heldOrder: [22, 11, 21, 41, 31, 51] }),
    );
    expect(held.cards.map((c) => c.paneId)).toEqual([22, 11, 21, 41, 31, 51]);
    expect(held.selected?.paneId).toBe(22);
    const grown = buildAgentBoard(input({ heldOrder: [22, 11] }));
    expect(grown.cards.slice(0, 2).map((c) => c.paneId)).toEqual([22, 11]);
    expect(grown.cards.length).toBe(6);
  });
  it("keeps the selected card even when a filter hides it", () => {
    const view = buildAgentBoard(input({ selectedPaneId: 41, statusFilter: "working" }));
    expect(view.cards.map((c) => c.paneId)).toEqual([11]);
    expect(view.selected?.paneId).toBe(41);
  });
  it("selects by digit among all live cards, 0 being the tenth", () => {
    const view = buildAgentBoard(input());
    expect(cardForDigit(view, "1")?.paneId).toBe(21);
    expect(cardForDigit(view, "6")?.paneId).toBe(51);
    expect(cardForDigit(view, "0")).toBeNull();
    expect(cardForDigit(view, "a")).toBeNull();
  });
});

describe("boardWhere", () => {
  it("drops a repeated segment", () => {
    const group = {
      key: "k",
      branch: "main",
      name: "main",
      path: DECK,
      repositoryPath: DECK,
      primary: false,
      labelled: true,
      entries: [],
      panes: [],
      live: true,
      age: "",
      active: false,
      rows: [],
    };
    expect(boardWhere("main", group, null)).toBe("main");
  });
});

describe("buildAgentBoard — hasRun", () => {
  it("carries each pane's own hasRun onto its card", () => {
    // The reply gate reads this off the CARD (DL-34.7): `submitAllowed` takes
    // no `hasRun` input, so nothing downstream could enforce "and the pane has
    // reached working once" without it. Pane 31 has never run a turn.
    const byId = new Map(buildAgentBoard(input()).all.map((card) => [card.paneId, card]));
    expect(byId.get(11)?.hasRun).toBe(true);
    expect(byId.get(31)?.hasRun).toBe(false);
  });
});
