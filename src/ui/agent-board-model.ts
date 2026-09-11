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
  /**
   * This pane's agent has reached `working` at least once (`PaneView.hasRun`).
   *
   * On the card because the REPLY needs it (DL-34.7): `submitAllowed` has no
   * `hasRun` input, so nothing downstream could enforce "and the pane has
   * reached working once" without it. Row 4's task rule already read the same
   * fact off `PaneView` — this is the same bit, projected.
   */
  readonly hasRun: boolean;
  readonly state: RailState;
  readonly name: string;
  readonly project: string;
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
  ended: 4,
};

/**
 * The word a card whose agent has LEFT prints in place of its state word
 * (DL-34.2, amended 2026-09-04 from the eye pass). A departed pane's state is
 * `idle` by construction, so before this a departed card and an idle one were
 * identical in picture AND in accessible name while offering different actions
 * — Restart against Stop. The word is the tell; nothing else moves. It is NOT
 * a sixth state: filtering, sorting and the nav's counts still read `idle`,
 * because a card the user can restart is still a quiet pane.
 */
export const DEPARTED_WORD = "ended";

/** The word a card prints in its `.board-label` slot (DL-34.5). */
export const STATE_WORD: Readonly<Record<RailState, string>> = {
  failed: "failed",
  asked: "asked",
  working: "working",
  done: "done",
  idle: "idle",
  ended: "ended",
};

/** The word for one card: `ended` once its agent has left, its state otherwise. */
export function stateWordFor(card: Pick<BoardCard, "state" | "departed">): string {
  return card.departed ? DEPARTED_WORD : STATE_WORD[card.state];
}

/** `All` plus every rail state but `failed`, which is spliced in conditionally below. */
const STATUS_ROWS: readonly { filter: RailState; label: string }[] = [
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

function whatOf(
  draft: Draft,
  input: AgentBoardInput,
): { what: BoardCardWhat; task: string | null; tail: string | null } {
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

function collect(input: AgentBoardInput): {
  drafts: Draft[];
  rail: ReturnType<typeof buildAgentRail>;
} {
  const rail = buildAgentRail(input);
  const located = new Map<number, Located>();
  input.tabs.forEach((tab, tabIndex) => {
    for (const pane of tab.panes ?? []) {
      located.set(pane.paneId, { pane, tab, tabIndex });
    }
  });
  const groups: { cluster: RailStreamGroup; group: RailWorktreeGroup }[] = [];
  for (const cluster of rail.stream) {
    for (const group of cluster.worktrees) {
      groups.push({ cluster, group });
    }
  }
  const drafts: Draft[] = [];
  for (const { cluster, group } of groups) {
    for (const cardPane of group.panes) {
      const hit = located.get(cardPane.paneId);
      if (hit !== undefined) {
        drafts.push({
          located: hit,
          cluster,
          group,
          agent: cardPane.agent,
          departed: hit.pane.phase === "exited",
        });
      }
    }
  }
  // Spec §5.1: a pane whose agent has left keeps its card, as `idle`, wearing
  // the departed agent's name. The rail drops shell panes entirely, so they
  // are found on the TAB and attached to the worktree group whose rows
  // contain that tab's index (searched across every group, not just the one
  // being visited); a shell-only tab with no `RailTabRow` in any group falls
  // back to the group whose `path` equals the tab's own `workspacePath`
  // (controller ruling, task 4 dispatch).
  for (const hit of located.values()) {
    if (hit.pane.agent !== null) continue;
    const last = input.lastAgents?.get(hit.pane.paneId);
    if (last === undefined) continue;
    const byRow = groups.find(({ group }) => group.rows.some((row) => row.index === hit.tabIndex));
    const target = byRow ?? groups.find(({ group }) => group.path === hit.tab.workspacePath);
    if (target === undefined) continue;
    drafts.push({
      located: hit,
      cluster: target.cluster,
      group: target.group,
      agent: last,
      departed: true,
    });
  }
  return { drafts, rail };
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

function toCard(
  draft: Draft,
  rank: number,
  agentPanesInTab: number,
  input: AgentBoardInput,
): BoardCard {
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
    hasRun: pane.hasRun,
    // Spec §5.1: a departed agent is `idle` whatever the latch says.
    state: draft.departed ? "idle" : paneState(pane),
    name: single ? (customName as string) : displayAgent(draft.agent),
    project: draft.cluster.project,
    where: boardWhere(draft.cluster.project, draft.group, single ? null : customName, input.home),
    checkoutKey: draft.group.key,
    checkout: draft.group.labelled
      ? checkoutLabel(draft.group)
      : tildePath(draft.group.path, input.home),
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
  const loud = [...cards].sort(
    (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.rank - b.rank,
  );
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
  const { drafts: unsorted, rail } = collect(input);
  const drafts = [...unsorted].sort(byOrdinal(input));
  const perTab = new Map<number, number>();
  for (const draft of drafts) {
    perTab.set(draft.located.tabIndex, (perTab.get(draft.located.tabIndex) ?? 0) + 1);
  }
  const all = drafts.map((draft, index) =>
    toCard(draft, index + 1, perTab.get(draft.located.tabIndex) ?? 1, input),
  );
  const cards = sortCards(
    all.filter((card) => visible(card, input)),
    input.heldOrder,
  );
  const counts = new Map<RailState, number>();
  for (const card of all) counts.set(card.state, (counts.get(card.state) ?? 0) + 1);
  // Spec §6: `Failed` is a row while some pane is failed, or while it is the
  // active filter — dropping it mid-filter would strand the user with no
  // `aria-selected` row and no way back to the state they are looking at.
  const showFailed = (counts.get("failed") ?? 0) > 0 || input.statusFilter === "failed";
  const status: BoardStatusRow[] = [
    {
      filter: "all",
      label: "All",
      count: all.length,
      active: input.statusFilter === "all",
    },
    ...(showFailed
      ? [
          {
            filter: "failed" as const,
            label: "Failed",
            count: counts.get("failed") ?? 0,
            active: input.statusFilter === "failed",
          },
        ]
      : []),
    ...STATUS_ROWS.map((row) => ({
      filter: row.filter,
      label: row.label,
      count: counts.get(row.filter) ?? 0,
      active: input.statusFilter === row.filter,
    })),
  ];
  // PROJECTS rows follow the RAIL's own order, not the ordinal-sorted
  // `drafts` — walking `rail.stream` here is what Task 5 pins.
  const projects: BoardProjectRow[] = [];
  const seen = new Set<string>();
  for (const cluster of rail.stream) {
    for (const group of cluster.worktrees) {
      const key = group.key;
      if (seen.has(key) || !all.some((card) => card.checkoutKey === key)) continue;
      seen.add(key);
      projects.push({
        key,
        label: boardWhere(cluster.project, group, null, input.home),
        count: all.filter((card) => card.checkoutKey === key).length,
        active: input.projectFilter === key,
      });
    }
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
