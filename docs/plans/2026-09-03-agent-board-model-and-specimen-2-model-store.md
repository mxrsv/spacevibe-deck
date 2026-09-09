# Agent Board — model, treatment and specimen — plan, part 2 of 5: the projection and the store (Tasks 4–6)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Read [part 1](2026-09-03-agent-board-model-and-specimen.md) first — goal, architecture, the spec link and the Global Constraints every task below inherits. Tasks are numbered across the five parts.

---

### Task 4: `agent-board-model.ts` — cards, where, name, what

**Files:**
- Create: `src/ui/agent-board-model.ts`
- Test: `src/ui/agent-board-model.test.ts`

**Interfaces:**
- Consumes: `buildAgentRail`, `paneState`, `formatShortAge`, `AgentRailInput`, `RailState`, `RailStreamGroup` from `./agent-rail-model`; `checkoutLabel`, `displayAgent`, `RailWorktreeGroup` from `./agent-rail-card-model`; `PaneView`, `TabView` from `../terminal/tabs-store`; `PaneAgent` from `../lib/process-info`; `UNSEQUENCED` from `../lib/open-sequence`.
- Produces (used by Tasks 5–11):

```ts
export type BoardStatusFilter = "all" | RailState;
export type BoardConfidence = "explicit" | "inferred";
export interface AgentBoardInput extends AgentRailInput {
  readonly ordinals: ReadonlyMap<number, number>;
  readonly startedAt?: ReadonlyMap<number, number>;
  readonly tasks?: ReadonlyMap<number, string>;
  readonly lastAgents?: ReadonlyMap<number, PaneAgent>;
  readonly confidence?: ReadonlyMap<number, BoardConfidence>;
  readonly home?: string;
  readonly selectedPaneId: number | null;
  readonly statusFilter: BoardStatusFilter;
  readonly projectFilter: string | null;
  readonly heldOrder: readonly number[] | null;
}
export interface BoardCardWhat { readonly kind: "task" | "tail" | "none"; readonly text: string; }
export interface BoardCard {
  readonly paneId: number; readonly tabIndex: number; readonly ordinal: number; readonly rank: number;
  readonly agent: PaneAgent; readonly departed: boolean; readonly state: RailState;
  readonly name: string; readonly where: string; readonly checkoutKey: string;
  readonly checkout: string; readonly branch: string | null; readonly directory: string;
  readonly what: BoardCardWhat; readonly task: string | null; readonly tail: string | null;
  readonly up: string; readonly changed: string; readonly confidence: BoardConfidence | null;
  readonly selected: boolean;
}
export interface BoardStatusRow { readonly filter: BoardStatusFilter; readonly label: string; readonly count: number; readonly active: boolean; }
export interface BoardProjectRow { readonly key: string; readonly label: string; readonly count: number; readonly active: boolean; }
export interface AgentBoardView {
  readonly all: readonly BoardCard[];   // every live card, rank order (1..n)
  readonly cards: readonly BoardCard[]; // the visible, sorted grid
  readonly total: number; readonly shown: number;
  readonly status: readonly BoardStatusRow[]; readonly projects: readonly BoardProjectRow[];
  readonly selected: BoardCard | null;
}
export const STATE_RANK: Readonly<Record<RailState, number>>;
export const STATE_WORD: Readonly<Record<RailState, string>>;
export function boardWhere(project: string, group: RailWorktreeGroup, customName: string | null, home?: string): string;
export function buildAgentBoard(input: AgentBoardInput): AgentBoardView;
export function cardForDigit(view: AgentBoardView, key: string): BoardCard | null;
```

- [ ] **Step 1: Write the failing tests** (`src/ui/agent-board-model.test.ts`). Build tabs with the same helpers `agent-rail-model.test.ts` uses (copy its `repo(...)` scan builder and a `pane(...)` builder rather than importing from a test file):

```ts
import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../repositories/repository-client";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { boardWhere, buildAgentBoard, cardForDigit, type AgentBoardInput } from "./agent-board-model";

const HOME = "/Users/deck";
// The cluster's project word is the primary checkout's BASENAME
// (`repository-model.ts`, `workspaceLabel(entries[0].path)`), not the scan
// key — so the fixture's basename is the word the assertions expect.
const DECK = `${HOME}/deck`;
const DECK_FIX = `${HOME}/deck-worktrees/fix-rail`;
const SCRATCH = `${HOME}/scratch`;

function repo(key: string, worktrees: readonly { path: string; branch?: string }[]): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: worktrees[0].path,
    worktrees: worktrees.map((entry) => ({
      path: entry.path, head: "0".repeat(40), branch: entry.branch ?? null,
      bare: false, detached: false, locked: null, prunable: null,
    })),
  };
}
const SCANS = new Map<string, RepositoryScan>([
  [DECK, repo("deck", [{ path: DECK, branch: "main" }, { path: DECK_FIX, branch: "fix/rail" }])],
  [DECK_FIX, repo("deck", [{ path: DECK, branch: "main" }, { path: DECK_FIX, branch: "fix/rail" }])],
  [SCRATCH, { kind: "plain", reason: "not a repository" }],
]);

function pane(paneId: number, agent: string | null, attention: PaneView["attention"], phase: PaneView["phase"], hasRun = false): PaneView {
  return { paneId, agent, attention, phase, hasRun, changedAt: 1_000, focused: false };
}
function tab(key: number, workspacePath: string, panes: readonly PaneView[], name: string | null = null): TabView {
  return {
    key, process: panes[0]?.agent ?? "zsh", name, dotColor: null, workspacePath,
    agents: panes.flatMap((p) => (p.agent ? [p.agent] : [])), agentBusy: false, unread: false, panes,
  };
}
function input(over: Partial<AgentBoardInput> = {}): AgentBoardInput {
  return {
    tabs: [
      tab(1, DECK, [pane(11, "claude", "none", "working", true)]),
      tab(2, DECK, [pane(21, "codex", "completed", "idle", true), pane(22, "claude", "none", "idle", true)], "api"),
      tab(3, DECK_FIX, [pane(31, "opencode", "none", "idle", false)]),
      tab(4, SCRATCH, [pane(41, "gemini", "error", "idle", true)]),
      tab(5, DECK, [pane(51, null, "completed", "idle", true)]),
    ],
    activeIndex: 0, scans: SCANS, workspaceHistoryPaths: [DECK, DECK_FIX, SCRATCH],
    tails: new Map([[11, "Reading the rail model"], [22, "Done with the tests"]]),
    ordinals: new Map([[11, 3], [21, 1], [22, 2], [31, 5], [41, 4], [51, 6]]),
    // Never 0: `formatShortAge` reads a 0 timestamp as "never" and prints "".
    startedAt: new Map([[11, 1], [21, 1]]),
    tasks: new Map([[11, "Refactor the rail model\nsecond line"], [31, "Never ran"]]),
    lastAgents: new Map([[51, "claude"]]),
    confidence: new Map([[11, "explicit"], [21, "inferred"]]),
    home: HOME, now: 600_001,
    selectedPaneId: null, statusFilter: "all", projectFilter: null, heldOrder: null,
    ...over,
  };
}

describe("buildAgentBoard — cards", () => {
  it("makes one card per agent pane plus one per departed pane, ranked by ordinal", () => {
    const view = buildAgentBoard(input());
    expect(view.all.map((c) => [c.paneId, c.rank])).toEqual([[21, 1], [22, 2], [11, 3], [41, 4], [31, 5], [51, 6]]);
    expect(view.total).toBe(6);
  });
  it("sorts loudest first, then by ordinal, and forces a departed card to idle", () => {
    const view = buildAgentBoard(input());
    expect(view.cards.map((c) => `${c.paneId}:${c.state}`)).toEqual([
      "41:failed", "21:asked", "11:working", "22:done", "31:idle", "51:idle",
    ]);
    expect(view.cards[5].departed).toBe(true);
    expect(view.cards[5].agent).toBe("claude");
  });
  it("names a single-agent tab by its custom name and a multi-agent tab by the agent, moving the tab name to where", () => {
    const view = buildAgentBoard(input({ tabs: [tab(2, DECK, [pane(21, "codex", "none", "idle", true)], "api")], ordinals: new Map([[21, 1]]) }));
    expect(view.all[0].name).toBe("api");
    expect(view.all[0].where).toBe("deck · main");
    const multi = buildAgentBoard(input());
    const codex = multi.all.find((c) => c.paneId === 21)!;
    expect(codex.name).toBe("Codex");
    expect(codex.where).toBe("deck · main · api");
  });
  it("prints a worktree as project · name · branch and a plain folder as its ~ path", () => {
    const view = buildAgentBoard(input());
    expect(view.all.find((c) => c.paneId === 31)!.where).toBe("deck · fix-rail · fix/rail");
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

describe("boardWhere", () => {
  it("drops a repeated segment", () => {
    const group = { key: "k", branch: "main", name: "main", path: DECK, repositoryPath: DECK, primary: false, labelled: true, entries: [], panes: [], live: true, age: "", active: false, rows: [] };
    expect(boardWhere("main", group, null)).toBe("main");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/ui/agent-board-model.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement** `src/ui/agent-board-model.ts`:

```ts
import { UNSEQUENCED } from "../lib/open-sequence";
import type { PaneAgent } from "../lib/process-info";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { checkoutLabel, displayAgent, type RailWorktreeGroup } from "./agent-rail-card-model";
import {
  buildAgentRail,
  formatShortAge,
  paneState,
  type AgentRailInput,
  type RailState,
  type RailStreamGroup,
} from "./agent-rail-model";

/**
 * The Agent Board's projection (spec §11.9): a second pure view over the
 * rail's own `buildAgentRail`, joined back to `PaneView` by pane id for the
 * fields a card needs that a rail row does not carry. Facts Deck does not
 * have yet (`ordinal`, `startedAt`, the task, `lastAgent`, confidence) arrive
 * as input maps until the wiring plan puts them on `PaneView`.
 */
export type BoardStatusFilter = "all" | RailState;
export type BoardConfidence = "explicit" | "inferred";

export interface AgentBoardInput extends AgentRailInput {
  readonly ordinals: ReadonlyMap<number, number>;
  readonly startedAt?: ReadonlyMap<number, number>;
  readonly tasks?: ReadonlyMap<number, string>;
  readonly lastAgents?: ReadonlyMap<number, PaneAgent>;
  readonly confidence?: ReadonlyMap<number, BoardConfidence>;
  readonly home?: string;
  readonly selectedPaneId: number | null;
  readonly statusFilter: BoardStatusFilter;
  readonly projectFilter: string | null;
  readonly heldOrder: readonly number[] | null;
}

export interface BoardCardWhat {
  readonly kind: "task" | "tail" | "none";
  readonly text: string;
}

export interface BoardCard {
  readonly paneId: number;
  readonly tabIndex: number;
  readonly ordinal: number;
  readonly rank: number;
  readonly agent: PaneAgent;
  readonly departed: boolean;
  readonly state: RailState;
  readonly name: string;
  readonly where: string;
  readonly checkoutKey: string;
  readonly checkout: string;
  readonly branch: string | null;
  readonly directory: string;
  readonly what: BoardCardWhat;
  readonly task: string | null;
  readonly tail: string | null;
  readonly up: string;
  readonly changed: string;
  readonly confidence: BoardConfidence | null;
  readonly selected: boolean;
}

export interface BoardStatusRow {
  readonly filter: BoardStatusFilter;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
}

export interface BoardProjectRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
}

export interface AgentBoardView {
  readonly all: readonly BoardCard[];
  readonly cards: readonly BoardCard[];
  readonly total: number;
  readonly shown: number;
  readonly status: readonly BoardStatusRow[];
  readonly projects: readonly BoardProjectRow[];
  readonly selected: BoardCard | null;
}

/** DL-27.3's loudest-wins fold, as a sort rank (spec §5.2). */
export const STATE_RANK: Readonly<Record<RailState, number>> = {
  failed: 0,
  asked: 1,
  working: 2,
  done: 3,
  idle: 4,
};

/** The word a card prints in its `.board-label` slot (DL-34.5). */
export const STATE_WORD: Readonly<Record<RailState, string>> = {
  failed: "failed",
  asked: "asked",
  working: "working",
  done: "done",
  idle: "idle",
};

const STATUS_ROWS: readonly { filter: BoardStatusFilter; label: string }[] = [
  { filter: "all", label: "All" },
  { filter: "asked", label: "Asked" },
  { filter: "working", label: "Working" },
  { filter: "done", label: "Done" },
  { filter: "idle", label: "Idle" },
];

function tildePath(path: string, home: string | undefined): string {
  if (home !== undefined && home !== "" && path.startsWith(home)) {
    const rest = path.slice(home.length);
    return rest === "" ? "~" : `~${rest}`;
  }
  return path;
}

function joinSaid(segments: readonly string[]): string {
  const said: string[] = [];
  for (const segment of segments) {
    if (segment !== "" && !said.includes(segment)) {
      said.push(segment);
    }
  }
  return said.join(" · ");
}

/**
 * `project · label · branch` with any repeated segment dropped — the words
 * main's `subjectWhere` prints (spec §5.3), formatted here because that
 * function does not exist on this branch (§11.9). A plain folder prints its
 * `~` path; a multi-agent tab's custom name closes the line.
 */
export function boardWhere(
  project: string,
  group: RailWorktreeGroup,
  customName: string | null,
  home?: string,
): string {
  const place = group.labelled
    ? [project, checkoutLabel(group), group.branch]
    : [tildePath(group.path, home)];
  return joinSaid(customName === null ? place : [...place, customName]);
}

interface Located {
  readonly pane: PaneView;
  readonly tab: TabView;
  readonly tabIndex: number;
}

interface Draft {
  readonly located: Located;
  readonly cluster: RailStreamGroup;
  readonly group: RailWorktreeGroup;
  readonly agent: PaneAgent;
  readonly departed: boolean;
}

function firstLine(text: string): string {
  const end = text.indexOf("\n");
  return (end === -1 ? text : text.slice(0, end)).trim();
}

function whatOf(draft: Draft, input: AgentBoardInput): { what: BoardCardWhat; task: string | null; tail: string | null } {
  const paneId = draft.located.pane.paneId;
  const task = input.tasks?.get(paneId) ?? null;
  const tail = input.tails?.get(paneId) ?? null;
  // Spec §5.3 row 4: the task leads once the pane has reached `working`
  // (`hasRun`); a placed-but-unsent prompt is not yet a task the agent has.
  if (task !== null && draft.located.pane.hasRun) {
    return { what: { kind: "task", text: firstLine(task) }, task, tail };
  }
  if (tail !== null && tail !== "") {
    return { what: { kind: "tail", text: tail }, task, tail };
  }
  return { what: { kind: "none", text: "" }, task, tail };
}

function collect(input: AgentBoardInput): Draft[] {
  const rail = buildAgentRail(input);
  const located = new Map<number, Located>();
  input.tabs.forEach((tab, tabIndex) => {
    for (const pane of tab.panes ?? []) {
      located.set(pane.paneId, { pane, tab, tabIndex });
    }
  });
  const drafts: Draft[] = [];
  for (const cluster of rail.stream) {
    for (const group of cluster.worktrees) {
      const tabIndexes = new Set(group.rows.map((row) => row.index));
      for (const cardPane of group.panes) {
        const hit = located.get(cardPane.paneId);
        if (hit !== undefined) {
          drafts.push({ located: hit, cluster, group, agent: cardPane.agent, departed: false });
        }
      }
      // Spec §5.1: a pane whose agent has left keeps its card, as `idle`,
      // wearing the departed agent's name. The rail drops shell panes, so
      // they are found on the tab, not on the group.
      for (const hit of located.values()) {
        if (!tabIndexes.has(hit.tabIndex) || hit.pane.agent !== null) continue;
        const last = input.lastAgents?.get(hit.pane.paneId);
        if (last === undefined) continue;
        drafts.push({ located: hit, cluster, group, agent: last, departed: true });
      }
    }
  }
  return drafts;
}

function ordinalOf(input: AgentBoardInput, paneId: number): number {
  return input.ordinals.get(paneId) ?? UNSEQUENCED;
}

function byOrdinal(input: AgentBoardInput) {
  return (a: Draft, b: Draft): number => {
    const oa = ordinalOf(input, a.located.pane.paneId);
    const ob = ordinalOf(input, b.located.pane.paneId);
    // An unknown ordinal sorts LAST, not first: `UNSEQUENCED` is 0.
    const ka = oa === UNSEQUENCED ? Number.MAX_SAFE_INTEGER : oa;
    const kb = ob === UNSEQUENCED ? Number.MAX_SAFE_INTEGER : ob;
    return ka - kb || a.located.pane.paneId - b.located.pane.paneId;
  };
}

function toCard(draft: Draft, rank: number, agentPanesInTab: number, input: AgentBoardInput): BoardCard {
  const { pane, tab, tabIndex } = draft.located;
  const single = agentPanesInTab === 1 && tab.name !== null && tab.name !== "";
  const customName = tab.name !== null && tab.name !== "" ? tab.name : null;
  const startedAt = input.startedAt?.get(pane.paneId);
  const { what, task, tail } = whatOf(draft, input);
  return {
    paneId: pane.paneId,
    tabIndex,
    ordinal: ordinalOf(input, pane.paneId),
    rank,
    agent: draft.agent,
    departed: draft.departed,
    // Spec §5.1: a departed agent is `idle` whatever the latch says.
    state: draft.departed ? "idle" : paneState(pane),
    name: single ? (customName as string) : displayAgent(draft.agent),
    where: boardWhere(draft.cluster.project, draft.group, single ? null : customName, input.home),
    checkoutKey: draft.group.key,
    checkout: draft.group.labelled ? checkoutLabel(draft.group) : tildePath(draft.group.path, input.home),
    branch: draft.group.labelled ? draft.group.branch : null,
    directory: draft.group.path,
    what,
    task,
    tail,
    up: startedAt === undefined ? "" : formatShortAge(startedAt, input.now),
    changed: formatShortAge(pane.changedAt, input.now),
    confidence: input.confidence?.get(pane.paneId) ?? null,
    selected: input.selectedPaneId === pane.paneId,
  };
}

function visible(card: BoardCard, input: AgentBoardInput): boolean {
  if (input.statusFilter !== "all" && card.state !== input.statusFilter) return false;
  if (input.projectFilter !== null && card.checkoutKey !== input.projectFilter) return false;
  return true;
}

function sortCards(cards: readonly BoardCard[], heldOrder: readonly number[] | null): BoardCard[] {
  const loud = [...cards].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.rank - b.rank);
  if (heldOrder === null) return loud;
  // Spec §5.2: while a panel is open the order is held; cards that arrived
  // since take their loud position after every held one.
  const held = new Map(heldOrder.map((paneId, index) => [paneId, index]));
  return loud
    .map((card, index) => ({ card, key: held.get(card.paneId) ?? heldOrder.length + index }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.card);
}

export function buildAgentBoard(input: AgentBoardInput): AgentBoardView {
  const drafts = collect(input).sort(byOrdinal(input));
  const perTab = new Map<number, number>();
  for (const draft of drafts) {
    perTab.set(draft.located.tabIndex, (perTab.get(draft.located.tabIndex) ?? 0) + 1);
  }
  const all = drafts.map((draft, index) =>
    toCard(draft, index + 1, perTab.get(draft.located.tabIndex) ?? 1, input),
  );
  const cards = sortCards(all.filter((card) => visible(card, input)), input.heldOrder);
  const counts = new Map<RailState, number>();
  for (const card of all) counts.set(card.state, (counts.get(card.state) ?? 0) + 1);
  const status: BoardStatusRow[] = STATUS_ROWS.map((row) => ({
    filter: row.filter,
    label: row.label,
    count: row.filter === "all" ? all.length : (counts.get(row.filter) ?? 0),
    active: input.statusFilter === row.filter,
  }));
  // Spec §6: `Failed` is a row only while some pane is failed.
  if ((counts.get("failed") ?? 0) > 0) {
    status.splice(1, 0, { filter: "failed", label: "Failed", count: counts.get("failed") ?? 0, active: input.statusFilter === "failed" });
  }
  const projects: BoardProjectRow[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = draft.group.key;
    if (seen.has(key)) continue;
    seen.add(key);
    projects.push({
      key,
      label: boardWhere(draft.cluster.project, draft.group, null, input.home),
      count: all.filter((card) => card.checkoutKey === key).length,
      active: input.projectFilter === key,
    });
  }
  return {
    all,
    cards,
    total: all.length,
    shown: cards.length,
    status,
    projects,
    selected: all.find((card) => card.selected) ?? null,
  };
}

/** Digit keys `1`–`9` and `0` (the tenth) select by rank (spec §5.2). */
export function cardForDigit(view: AgentBoardView, key: string): BoardCard | null {
  if (!/^[0-9]$/.test(key)) return null;
  const rank = key === "0" ? 10 : Number(key);
  return view.all.find((card) => card.rank === rank) ?? null;
}
```

Note on ordering of PROJECTS rows: `drafts` is ordinal-sorted at that point, so re-derive the rows from the RAIL's order instead — iterate `rail.stream` clusters and their `worktrees` (keep a reference to `rail` from `collect`; refactor `collect` to return `{ drafts, rail }`). The test below pins that order.

- [ ] **Step 4: Run to see it pass** — `npx vitest run src/ui/agent-board-model.test.ts` → PASS. `npx tsc --noEmit` → clean. (`buildAgentRail` fills `RailWorktreeGroup.panes` for live tabs — `agent-rail-model.ts` around L662–683, via `buildCardEntries` filtered to `kind === "agent"` — so the join needs no fallback.)

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/agent-board-model.ts src/ui/agent-board-model.test.ts && npx prettier --check src/ui/agent-board-model.ts src/ui/agent-board-model.test.ts
git commit -m "feat(board): project the rail's panes into board cards

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/agent-board-model.ts src/ui/agent-board-model.test.ts
```

---

### Task 5: Model — filters, nav rows, held order, digits

**Files:**
- Modify: `src/ui/agent-board-model.ts`
- Test: `src/ui/agent-board-model.test.ts`

**Interfaces:** unchanged from Task 4; this task pins the behaviour the nav and grid rely on.

- [ ] **Step 1: Add the failing tests**

```ts
describe("buildAgentBoard — nav and filters", () => {
  it("counts totals per state, omits Failed while nothing is failed, and includes it otherwise", () => {
    const view = buildAgentBoard(input());
    expect(view.status.map((r) => `${r.label}:${r.count}`)).toEqual(["All:6", "Failed:1", "Asked:1", "Working:1", "Done:1", "Idle:2"]);
    const calm = buildAgentBoard(input({ tabs: [tab(1, DECK, [pane(11, "claude", "none", "working", true)])], ordinals: new Map([[11, 1]]) }));
    expect(calm.status.map((r) => r.label)).toEqual(["All", "Asked", "Working", "Done", "Idle"]);
  });
  it("lists one PROJECTS row per checkout holding a card, in the rail's order, with card counts", () => {
    const view = buildAgentBoard(input());
    expect(view.projects.map((r) => `${r.label}=${r.count}`)).toEqual(["deck · main=4", "deck · fix-rail · fix/rail=1", "~/scratch=1"]);
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
    const held = buildAgentBoard(input({ selectedPaneId: 22, heldOrder: [22, 11, 21, 41, 31, 51] }));
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
```

- [ ] **Step 2: Run** — `npx vitest run src/ui/agent-board-model.test.ts` → the PROJECTS-order test fails if rows were derived from ordinal order.

- [ ] **Step 3: Make it pass** — have `collect` return `{ drafts, rail }` and build `projects` by walking `rail.stream` → `cluster.worktrees` in that order, emitting a row for each group that has at least one draft (`drafts.some((d) => d.group.key === group.key)`).

- [ ] **Step 4: Run** — `npx vitest run src/ui/agent-board-model.test.ts` → PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/agent-board-model.ts src/ui/agent-board-model.test.ts && npx prettier --check src/ui/agent-board-model.ts src/ui/agent-board-model.test.ts
git commit -m "feat(board): count the nav, filter the grid and hold the order while a panel is open

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/agent-board-model.ts src/ui/agent-board-model.test.ts
```

---

### Task 6: `agent-board-store.ts`

**Files:**
- Create: `src/ui/agent-board-store.ts`
- Test: `src/ui/agent-board-store.test.ts`

**Interfaces:**
- Consumes: `signal` from `@preact/signals`; `nextOpenSequence`, `UNSEQUENCED` from `../lib/open-sequence`; `BoardStatusFilter` from `./agent-board-model`.
- Produces:

```ts
export const agentBoardOpen: Signal<boolean>;
export const agentBoardOpenedAt: Signal<number>;
export const agentBoardSurfaceActive: Signal<boolean>;
export const boardSelectedPaneId: Signal<number | null>;
export const boardStatusFilter: Signal<BoardStatusFilter>;
export const boardProjectFilter: Signal<string | null>;
export const boardHeldOrder: Signal<readonly number[] | null>;
export const paneOrdinals: Signal<ReadonlyMap<number, number>>;
export function notePaneIds(paneIds: readonly number[]): void;   // allocate unseen, drop gone; replaces the map
export function openAgentBoard(): void;        // chip exists, slot taken once, holds the stage
export function activateAgentBoard(): void;    // chip already exists: holds the stage
export function stepAgentBoardBack(): void;    // surface off, chip stays
export function closeAgentBoard(): void;       // ⌘W: chip gone, everything Board-local reset (spec §4.4)
export function selectBoardCard(paneId: number | null, currentOrder: readonly number[]): void; // sets selection; snapshots the held order on select, clears it on null
export function resetAgentBoardStore(): void;  // tests
```

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetOpenSequence, UNSEQUENCED } from "../lib/open-sequence";
import {
  agentBoardOpen, agentBoardOpenedAt, agentBoardSurfaceActive, boardHeldOrder, boardProjectFilter,
  boardSelectedPaneId, boardStatusFilter, closeAgentBoard, notePaneIds, openAgentBoard, paneOrdinals,
  resetAgentBoardStore, selectBoardCard, stepAgentBoardBack,
} from "./agent-board-store";

describe("agent-board-store", () => {
  beforeEach(() => { resetOpenSequence(); resetAgentBoardStore(); });

  it("allocates an ordinal once per pane id in first-seen order and drops gone panes", () => {
    notePaneIds([7, 3]);
    const first = paneOrdinals.value;
    expect([...first.entries()]).toEqual([[7, 1], [3, 2]]);
    notePaneIds([3, 9]);
    expect([...paneOrdinals.value.entries()]).toEqual([[3, 2], [9, 3]]);
    expect(paneOrdinals.value).not.toBe(first);
  });
  it("opens once, takes one open-order slot, and steps back without losing the chip", () => {
    openAgentBoard();
    expect(agentBoardOpen.value).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(true);
    const slot = agentBoardOpenedAt.value;
    expect(slot).not.toBe(UNSEQUENCED);
    stepAgentBoardBack();
    expect(agentBoardOpen.value).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(false);
    openAgentBoard();
    expect(agentBoardOpenedAt.value).toBe(slot);
  });
  it("snapshots the held order on select and clears it on deselect", () => {
    selectBoardCard(4, [4, 2, 9]);
    expect(boardSelectedPaneId.value).toBe(4);
    expect(boardHeldOrder.value).toEqual([4, 2, 9]);
    selectBoardCard(null, []);
    expect(boardSelectedPaneId.value).toBeNull();
    expect(boardHeldOrder.value).toBeNull();
  });
  it("close resets every Board-local value and the chip", () => {
    openAgentBoard();
    boardStatusFilter.value = "asked";
    boardProjectFilter.value = "deck";
    selectBoardCard(4, [4]);
    closeAgentBoard();
    expect(agentBoardOpen.value).toBe(false);
    expect(agentBoardSurfaceActive.value).toBe(false);
    expect(agentBoardOpenedAt.value).toBe(UNSEQUENCED);
    expect(boardStatusFilter.value).toBe("all");
    expect(boardProjectFilter.value).toBeNull();
    expect(boardSelectedPaneId.value).toBeNull();
    expect(boardHeldOrder.value).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/ui/agent-board-store.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { signal } from "@preact/signals";
import { nextOpenSequence, UNSEQUENCED } from "../lib/open-sequence";
import type { BoardStatusFilter } from "./agent-board-model";

/**
 * The Agent Board's window-scoped state (spec §4.2, §11.3) — the browser
 * store's shape, deliberately NOT `boardOpen` in `chrome/events.ts`, which is
 * the Open Board's. Three signals say whether the chip exists, where it sits
 * in the strip's open order, and whether it holds the stage; the rest is
 * Board-local and resets when the chip closes (§4.4).
 */
export const agentBoardOpen = signal(false);
export const agentBoardOpenedAt = signal(UNSEQUENCED);
export const agentBoardSurfaceActive = signal(false);

export const boardSelectedPaneId = signal<number | null>(null);
export const boardStatusFilter = signal<BoardStatusFilter>("all");
export const boardProjectFilter = signal<string | null>(null);
export const boardHeldOrder = signal<readonly number[] | null>(null);

/**
 * Pane ordinals (spec §11.1): allocated from the window's open-order clock
 * the first time the tab layer lists a pane id, dropped when it goes. The
 * wiring plan calls `notePaneIds` from `syncViews`; here it is a pure seam.
 */
export const paneOrdinals = signal<ReadonlyMap<number, number>>(new Map());

export function notePaneIds(paneIds: readonly number[]): void {
  const previous = paneOrdinals.value;
  const next = new Map<number, number>();
  for (const paneId of paneIds) {
    next.set(paneId, previous.get(paneId) ?? nextOpenSequence());
  }
  paneOrdinals.value = next;
}

export function openAgentBoard(): void {
  if (!agentBoardOpen.value) {
    agentBoardOpen.value = true;
    agentBoardOpenedAt.value = nextOpenSequence();
  }
  agentBoardSurfaceActive.value = true;
}

export function activateAgentBoard(): void {
  if (agentBoardOpen.value) {
    agentBoardSurfaceActive.value = true;
  }
}

export function stepAgentBoardBack(): void {
  agentBoardSurfaceActive.value = false;
}

export function selectBoardCard(paneId: number | null, currentOrder: readonly number[]): void {
  boardSelectedPaneId.value = paneId;
  boardHeldOrder.value = paneId === null ? null : [...currentOrder];
}

function resetBoardLocal(): void {
  boardSelectedPaneId.value = null;
  boardStatusFilter.value = "all";
  boardProjectFilter.value = null;
  boardHeldOrder.value = null;
}

export function closeAgentBoard(): void {
  agentBoardOpen.value = false;
  agentBoardSurfaceActive.value = false;
  agentBoardOpenedAt.value = UNSEQUENCED;
  resetBoardLocal();
}

export function resetAgentBoardStore(): void {
  closeAgentBoard();
  paneOrdinals.value = new Map();
}
```

- [ ] **Step 4: Run** — `npx vitest run src/ui/agent-board-store.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/agent-board-store.ts src/ui/agent-board-store.test.ts && npx prettier --check src/ui/agent-board-store.ts src/ui/agent-board-store.test.ts
git commit -m "feat(board): add the window-scoped board store and the pane ordinal allocator

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/agent-board-store.ts src/ui/agent-board-store.test.ts
```

---

