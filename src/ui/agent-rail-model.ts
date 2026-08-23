/**
 * The agent rail's view model: open tabs and repository scans in, one list of
 * per-project live clusters out.
 *
 * Pure, and for the same reason
 * [`repository-model.ts`](../repositories/repository-model.ts) `current` is:
 * every precedence, fold and ordering decision in
 * `docs/specs/2026-08-16-agent-status-rail-design.md` §2/§3 lives here and
 * none of them is observable from a screenshot. The component only renders
 * what this returns.
 *
 * Grouping is NOT reimplemented — `buildRail` already knows how to attach a tab
 * to its worktree (longest-prefix, so a tab opened on a package below the root
 * still lands in the right checkout) and `filterRailToWorkspaceHistory` already
 * knows that git discovery supplies metadata rather than deciding which
 * never-opened sibling becomes a row. This module reads those groups and flips
 * the unit from checkout to tab.
 *
 * The clock is injected (`AgentRailInput.now`). Nothing here calls `Date.now`.
 */
import type { PaneAgent } from "../lib/process-info";
import { workspaceLabel } from "../lib/workspace-label";
import type { RepositoryScan } from "../repositories/repository-client";
import type { RailTab, RepositoryGroup, WorktreeRow } from "../repositories/repository-model";
import {
  buildRail,
  filterRailToWorkspaceHistory,
  worktreeForPath,
} from "../repositories/repository-model";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { NO_PANES } from "../terminal/tabs-store";
import { UNSEQUENCED } from "../lib/open-sequence";
// Type-only the other way (`RailStreamGroup`), so the pair is a compile-time
// cycle and never a runtime one.
import { applyRailOrder } from "./rail-order";

/**
 * Spec §3, revocabularised on the owner's ask (2026-08-16) to read from the
 * dev's side rather than the agent's: `asked` is everything waiting on your
 * eyes (a question, a permission wait, or a finished run you have not checked
 * — the old `done` folded in here, TEMPORARILY, so unfolding it is one case
 * label in `paneState`); `done` is a run you checked; `idle` is a pane whose
 * agent has never run anything. `idle` and the accent-ringed `done` are
 * gone.
 */
export type RailState = "failed" | "asked" | "working" | "done" | "idle";

/** One agent pane inside a tab row. */
export interface RailPaneRow {
  readonly paneId: number;
  readonly agent: PaneAgent;
  readonly state: RailState;
  /**
   * Head of this pane's newest turn when `AgentRailInput.tails` carries one,
   * else empty.
   *
   * Empty means "this agent has said nothing", never "print the tab's name
   * instead": since DL-27.15's one-line amendment (2026-08-17) the turn takes
   * the AGENT NAME's place on the row, so a fallback here would put a word the
   * user typed where the sentence the agent said belongs.
   */
  readonly message: string;
  /** Short relative string for this pane alone; empty before any change. */
  readonly age: string;
  readonly changedAt: number;
  /**
   * This pane holds the WINDOW's keyboard focus (DL-27.22, owner 2026-08-23):
   * `PaneView.focused` ANDed with its tab's own `active`. True for **at most
   * one row in the whole rail** — every tab has a focused pane of its own, so
   * reporting each one would light a row per tab and say nothing.
   *
   * The AND lives here rather than in the component because it is the whole
   * invariant, and a pure function is where it can be asserted.
   */
  readonly focused: boolean;
}

export interface RailTabRow {
  /** `TabView.key` — list identity, and the popover anchor key. */
  readonly key: number;
  /** Global tab index — the coordinate every callback takes. */
  readonly index: number;
  /** The workspace's own name. */
  readonly project: string;
  /**
   * What this tab is, when the cluster header above it has already said where
   * it is: the user's own tab name, else the agents running in it, else
   * `shell`. Rendered in place of `project` inside a labelled cluster (§2.4),
   * and itself given up to `message` once an agent here has spoken — unless
   * `named`, since a word the user typed is not a stand-in for a turn.
   */
  readonly identity: string;
  /** Rendered only when the tab is NOT in the repository's primary checkout. */
  readonly worktree: string | null;
  /** The tab's own label (custom name, else workspace label). */
  readonly title: string;
  /** True when the label is a name a PERSON typed, not one derived from a path. */
  readonly named: boolean;
  /**
   * The newest turn of the pane this row speaks for, or empty when no agent
   * here has said anything. It shares the row's one line with `identity`
   * rather than sitting under it (DL-27.15, amended 2026-08-17).
   */
  readonly message: string;
  /** Short relative string, e.g. `2m`. Empty when nothing has changed yet. */
  readonly age: string;
  readonly changedAt: number;
  /**
   * Where this tab sits in the window's one open order
   * ([`open-sequence.ts`](../lib/open-sequence.ts)) — the rail's ordering key
   * since 2026-08-16, shared with the tab strip so a project cannot sit in one
   * place on the strip and another in the rail. `UNSEQUENCED` for a tab built
   * before the field existed, which sorts by `index` instead.
   */
  readonly openedAt: number;
  /** Folded state of the whole tab, under DL-27.3's precedence. */
  readonly state: RailState;
  /** Agent panes only, in pane order. Shell panes are not rows (spec §9). */
  readonly panes: readonly RailPaneRow[];
  /** The pane a folded row speaks for: the loudest one. Null with no agents. */
  readonly voice: RailPaneRow | null;
  /** True for the tab `activeIndex` names. */
  readonly active: boolean;
  /** Workspace path, for the logo drop target and the popover. */
  readonly workspacePath: string | null;
}

/**
 * One project's stretch of the stream (§2.4).
 *
 * The stream is grouped rather than flat because the project name is the
 * loudest word in a row and N tabs in one project printed it N times, scattered
 * by recency. Grouping moves the name up one level; it does NOT reinstate the
 * repository → worktree tree §9 rules out — a cluster has no state, age or
 * worktree level, and its one control only collapses its tab rows.
 *
 * Since 2026-08-16 a cluster holds EVERY tab of its project, including the ones
 * waiting on the user: the pinned block that used to lift those out is gone, so
 * a project is printed in exactly one place and its tabs are all under it.
 */
export interface RailStreamGroup {
  /** `RepositoryGroup.key` — list identity. */
  readonly key: string;
  /**
   * Stable project identity across the live/remembered tiers — the repository
   * key, or `plain:<path>` for a folder git does not know. `key` carries a
   * tier prefix and therefore changes when the last tab closes; this does not.
   * The manual rail order is stored against this and nothing else
   * ([`rail-order.ts`](./rail-order.ts) `current`, spec §3).
   *
   * It is PRODUCED, not derived by stripping a prefix off `key`: the live
   * branch writes the group key it already has, the remembered branch writes
   * the un-prefixed key it already computes, and no consumer has to know the
   * prefix exists.
   */
  readonly orderKey: string;
  /** The project name, printed once above the rows. */
  readonly project: string;
  /**
   * Whether the header is printed. The current project → tab contract labels
   * every non-empty cluster, including one-tab projects, so this is always
   * true for `buildAgentRail` output.
   */
  readonly labelled: boolean;
  readonly rows: readonly RailTabRow[];
  /**
   * The workspace the header's `+` opens into when the cluster has no rows —
   * a REMEMBERED project (owner, 2026-08-20): a workspace from Deck's
   * persisted history whose last tab has closed. Null for a live cluster,
   * whose rows carry their own workspace paths.
   */
  readonly path: string | null;
  /**
   * EVERY history entry this cluster stands for — a repository scan folds
   * several remembered worktrees of one repository into one header, so
   * removing the header must remove them all or it re-derives from the
   * sibling entry on the next render and the X appears to do nothing.
   *
   * Populated for a LIVE cluster too since 2026-08-22 (close model, row 4):
   * the header's ✕ closes every tab of the project AND takes the project off
   * the rail, and closing the tabs alone would only demote the cluster to the
   * remembered tier — the header would stay put and the X would read as
   * broken. These are the history entries `rememberedClusters` currently
   * SUPPRESSES because this cluster already covers them: same repository key,
   * or prefix-attached to one of its worktrees.
   */
  readonly historyPaths: readonly string[];
  /**
   * Every open tab index this cluster holds, ascending — the coordinate the
   * header's ✕ closes with. Derived rather than re-read from `rows` by the
   * component so the "one project, one close" unit is stated once, here,
   * where the folding rule that makes a secondary worktree part of this
   * project already lives. Empty for a remembered cluster.
   *
   * Ascending is for READING, not for safety: `closeTabs` resolves every index
   * to its tab entry before the first dispose and re-pins each one by identity
   * afterwards, so no order of this list can hand it a stale coordinate.
   */
  readonly tabIndexes: readonly number[];
}

export interface AgentRailView {
  /**
   * Every open tab, clustered by project, in the order things were opened —
   * followed by the rowless remembered clusters (workspace history entries
   * with nothing open in them, owner 2026-08-20).
   */
  readonly stream: readonly RailStreamGroup[];
}

export interface AgentRailInput {
  readonly tabs: readonly TabView[];
  readonly activeIndex: number;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  /** Deck's persisted workspace history, newest first. */
  readonly workspaceHistoryPaths: readonly string[];
  /**
   * The newest turn of each agent pane, by pane id — spec §10's tier 3. Absent
   * for a pane whose session has said nothing yet, and absent entirely for a
   * caller that reads no sessions at all (the gallery, most tests), which is
   * why the whole map is optional rather than empty-by-convention: a rail with
   * no tails is the shape this model shipped with, not a degraded one.
   */
  readonly tails?: ReadonlyMap<number, string>;
  /**
   * The order the user dragged the project clusters into, by
   * `RailStreamGroup.orderKey`, top first (spec §5). Optional and defaulting
   * to empty so every existing caller — the gallery, the tests — keeps the
   * stream it had: with no manual order `applyRailOrder` returns the assembled
   * list untouched.
   */
  readonly railOrder?: readonly string[];
  /** Injected clock — the model never calls `Date.now()` itself. */
  readonly now: number;
}

/** DL-27.3's precedence, as numbers, so the fold has one comparison to make. */
const STATE_RANK: Readonly<Record<RailState, number>> = {
  failed: 4,
  asked: 3,
  working: 2,
  done: 1,
  idle: 0,
};

/** The rail has no collapse affordance — it is one flat list (spec §2). */
const NO_COLLAPSED_REPOSITORIES: ReadonlySet<string> = new Set();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Spec §3's mapping, under the 2026-08-16 vocabulary.
 *
 * Attention is read BEFORE phase: the tracker latches attention and leaves
 * phase live, so a pane can be `working` while carrying a warning nobody has
 * answered, and the latched state is the one the user has to act on.
 * `warning` folds into `asked` (§4.6), and so does `completed` — the owner's
 * temporary merge: a finished run you have not checked needs your eyes the
 * same way a question does, so both wear the yellow mark. The tracker still
 * distinguishes them; unfolding is restoring one case label here.
 *
 * A quiet pane splits on the tracker's `hasRun` bit: `done` is a run you
 * checked, `idle` is an agent that has never run anything.
 */
function paneState(pane: PaneView): RailState {
  switch (pane.attention) {
    case "error":
      return "failed";
    case "requested":
    case "warning":
    case "completed":
      return "asked";
    default:
      if (pane.phase === "working") {
        return "working";
      }
      return pane.hasRun ? "done" : "idle";
  }
}

/**
 * The agent panes of one tab, in pane order.
 *
 * Shell and test-runner panes are dropped here and nowhere else: spec §9 says
 * the rail answers "which agent", so they are not rows — but they remain part
 * of the tab, which is why `tabs-store.ts` reports every pane and the filter
 * lives with the surface instead.
 *
 * The tail is read PER PANE rather than for the tab as a whole: two agents in
 * one tab have two conversations, so one of them having said something recent
 * must not put that sentence under the other's name.
 */
function paneRows(
  tab: TabView | undefined,
  tails: ReadonlyMap<number, string> | undefined,
  now: number,
  active: boolean,
): RailPaneRow[] {
  return (tab?.panes ?? NO_PANES).flatMap((pane) =>
    pane.agent === null
      ? []
      : [
          {
            paneId: pane.paneId,
            agent: pane.agent,
            message: tails?.get(pane.paneId) ?? "",
            state: paneState(pane),
            age: formatShortAge(pane.changedAt, now),
            changedAt: pane.changedAt,
            // DL-27.22: the tab's focused pane is only the WINDOW's focused
            // pane while that tab is the one on the stage.
            focused: active && pane.focused === true,
          },
        ],
  );
}

/** A label the user typed, as opposed to one derived from the workspace path. */
function isNamed(railTab: RailTab): boolean {
  return railTab.customName !== null && railTab.customName !== "";
}

/**
 * What a row is called inside a labelled cluster, in order of how much it says:
 * the user's own tab name, else its one agent, else NOTHING, else `shell`.
 * Since the pane tree (2026-08-16), a multi-agent tab lists every agent as a
 * leaf row of its own — the tree IS the identity, so an unnamed parent prints
 * no label at all: the owner dropped the `N agents` count the same day it was
 * added, as a declaration the leaves already make.
 */
function identityOf(railTab: RailTab, panes: readonly RailPaneRow[]): string {
  if (isNamed(railTab)) {
    return railTab.customName ?? "";
  }
  if (panes.length === 0) {
    return "shell";
  }
  return panes.length === 1 ? panes[0].agent : "";
}

/**
 * The one turn a FOLDED view of a tab shows: the tail of the pane this tab's
 * rail row would speak for, or empty when no agent in it has said anything.
 *
 * Exported for the tab strip (DL-18.10, amended 2026-08-17), which prints the
 * same sentence on its chip. It reads through the same `loudestPane`
 * precedence rather than reimplementing "which pane speaks", so the strip and
 * the rail can never quote two different agents for one tab.
 */
export function tabTail(
  tab: TabView | undefined,
  tails: ReadonlyMap<number, string> | undefined,
): string {
  // `now` only formats the age this caller does not read; the tails and the
  // precedence are what it is here for. `active: false` for the same reason —
  // a chip reports no focus (DL-18.10), so the flag is inert on this path.
  return loudestPane(paneRows(tab, tails, 0, false))?.message ?? "";
}

/**
 * The pane a folded row speaks for: highest rank, then the newest change, then
 * pane order. The tab's own state is this pane's state, which is DL-27.3's
 * precedence expressed once rather than twice.
 */
function loudestPane(panes: readonly RailPaneRow[]): RailPaneRow | null {
  let loudest: RailPaneRow | null = null;
  for (const pane of panes) {
    if (loudest === null || outranks(pane, loudest)) {
      loudest = pane;
    }
  }
  return loudest;
}

function outranks(pane: RailPaneRow, incumbent: RailPaneRow): boolean {
  const delta = STATE_RANK[pane.state] - STATE_RANK[incumbent.state];
  return delta > 0 || (delta === 0 && pane.changedAt > incumbent.changedAt);
}

function tabRow(
  group: RepositoryGroup,
  worktree: WorktreeRow,
  railTab: RailTab,
  input: AgentRailInput,
): RailTabRow {
  const title = railTab.label;
  const tab = input.tabs[railTab.index];
  const panes = paneRows(tab, input.tails, input.now, railTab.active);
  const voice = loudestPane(panes);
  // A folded row says what the pane it speaks for is saying, so the sentence
  // on the row and the mark beside it come from the same agent. With no agent
  // pane at all there is nothing said and the row keeps its own name.
  const message = voice?.message ?? "";
  // A tab with no agent panes has never run an agent: `idle`, not `done`.
  const state = voice?.state ?? "idle";
  // Agent panes only: a tab whose shells have been busy all morning has still
  // said nothing an agent rail can report, so its age stays empty.
  const changedAt = panes.reduce((newest, pane) => Math.max(newest, pane.changedAt), 0);
  return {
    key: railTab.key,
    index: railTab.index,
    project: group.name,
    // 46 of 51 repositories in the measured corpus have exactly one working
    // directory (spec §1), so naming the checkout on every row would print a
    // word that says nothing. It is a suffix for the exception only.
    worktree: worktree.primary ? null : worktree.name,
    identity: identityOf(railTab, panes),
    title,
    named: isNamed(railTab),
    message,
    age: formatShortAge(changedAt, input.now),
    changedAt,
    openedAt: tab?.openedAt ?? UNSEQUENCED,
    state,
    panes,
    voice,
    active: railTab.active,
    workspacePath: railTab.workspacePath,
  };
}

/**
 * The order the user opened these tabs in, oldest first; the tab index breaks
 * ties for fixtures that carry no open key.
 *
 * NOT recency, since 2026-08-16: a list that reorders itself whenever an agent
 * changes state moves the row a person is reaching for, and the state mark
 * already says what happened without moving anything. This is the same key the
 * tab strip sorts by, so the strip and the rail cannot disagree about where a
 * tab sits.
 */
function sortByOpenOrder(rows: readonly RailTabRow[]): readonly RailTabRow[] {
  return [...rows].sort(
    (left, right) => left.openedAt - right.openedAt || left.index - right.index,
  );
}

/**
 * Clusters carry the same order the rows inside them do, one level up: a
 * project sits where its OLDEST tab put it, so opening a second tab in a
 * project already on screen never moves that project. Nothing here reorders by
 * name — the rail is a resume surface, not a directory (spec §1).
 */
function sortClusters(groups: readonly RailStreamGroup[]): readonly RailStreamGroup[] {
  return [...groups].sort(
    (left, right) => openedFirst(left) - openedFirst(right) || firstOf(left) - firstOf(right),
  );
}

function openedFirst(group: RailStreamGroup): number {
  return group.rows.reduce(
    (oldest, row) => Math.min(oldest, row.openedAt),
    Number.MAX_SAFE_INTEGER,
  );
}

/** Tie-break for clusters whose tabs carry no open key: the tabs' own order. */
function firstOf(group: RailStreamGroup): number {
  return group.rows.reduce((lowest, row) => Math.min(lowest, row.index), Number.MAX_SAFE_INTEGER);
}

/** Every live project keeps the same project → tab hierarchy. */
const LOWEST_LABELLED_SIZE = 1;
const NO_ARCHIVED_PATHS: ReadonlySet<string> = new Set();
/** A remembered cluster has no open tab to close. */
const NO_TAB_INDEXES: readonly number[] = [];
/** No project has ever been dragged — the stream stands as assembled. */
const NO_RAIL_ORDER: readonly string[] = [];

/**
 * Remembered projects (owner, 2026-08-20): every workspace in Deck's
 * persisted history keeps a header on the rail after its last tab closes, so
 * a project the user was just in stays one `+` away instead of vanishing with
 * its work. The clusters are ROWLESS — nothing is open in them — and follow
 * the live clusters in history order (newest first; the history itself is
 * `MAX_RECENTS`-bounded upstream). A repository scan folds several remembered
 * worktrees of one repository into one cluster, exactly as the live tier
 * groups them; a path git does not know stands alone under its folder name.
 */
function rememberedClusters(
  input: AgentRailInput,
  livePaths: readonly string[],
): RailStreamGroup[] {
  const clusters: RailStreamGroup[] = [];
  // Folded siblings accumulate here: the FIRST history entry of a repository
  // makes the cluster, and every later worktree of the same repository joins
  // its `historyPaths` instead of printing a second header.
  const byKey = new Map<string, string[]>();
  for (const path of input.workspaceHistoryPaths) {
    // A history workspace some live cluster already covers is not repeated:
    // longest-prefix, the same attachment rule tabs use, so a remembered
    // subdirectory of a live worktree stays under the live header.
    if (worktreeForPath(livePaths, path) !== null) {
      continue;
    }
    const scan = input.scans.get(path);
    const repository = scan?.kind === "repository" ? scan : null;
    const key = repository?.key ?? `plain:${path}`;
    const folded = byKey.get(key);
    if (folded !== undefined) {
      folded.push(path);
      continue;
    }
    const historyPaths = [path];
    byKey.set(key, historyPaths);
    // Named like the live tier: after the repository's own checkout when a
    // scan knows it, else after the folder itself.
    const primary = repository?.worktrees.find((entry) => !entry.bare) ?? null;
    clusters.push({
      key: `remembered:${key}`,
      // The un-prefixed key, which is exactly what the live tier stores this
      // project under — that identity is what survives the last tab closing
      // (spec §3).
      orderKey: key,
      project: workspaceLabel(primary?.path ?? path),
      labelled: true,
      rows: [],
      path,
      historyPaths,
      // Nothing is open here — the remembered header's ✕ forgets, it never
      // closes (owner, 2026-08-20; unchanged by the close model).
      tabIndexes: NO_TAB_INDEXES,
    });
  }
  return clusters;
}

/**
 * Every persisted history entry a LIVE cluster stands for (close model, 2026-08-22).
 *
 * Two rules, because `rememberedClusters` uses two and the header's ✕ has to
 * clear whatever either of them would have re-derived:
 *
 * - **Prefix attach.** A history entry under one of this cluster's open
 *   worktrees is suppressed from the remembered tier today by exactly this
 *   test, so it is this cluster's to forget.
 * - **Same project key.** A worktree of this repository that is in history but
 *   has nothing open in it is NOT prefix-attached to any live path, so it
 *   would build its own remembered cluster carrying this project's own
 *   `orderKey`. "Remove the project from the rail" has to take that with it,
 *   or the header the user pressed reappears under the same name.
 *
 * Order follows `workspaceHistoryPaths` (newest first) and duplicates cannot
 * arise: one pass, one entry each.
 */
function coveredHistoryPaths(group: RepositoryGroup, input: AgentRailInput): readonly string[] {
  const worktreePaths = group.worktrees.map((worktree) => worktree.path).filter((p) => p !== "");
  const covered: string[] = [];
  for (const path of input.workspaceHistoryPaths) {
    const scan = input.scans.get(path);
    const key = scan?.kind === "repository" ? scan.key : `plain:${path}`;
    if (key === group.key || worktreeForPath(worktreePaths, path) !== null) {
      covered.push(path);
    }
  }
  return covered;
}

/**
 * Build the rail: one cluster per live project in open order, then a rowless
 * remembered cluster for each history workspace with nothing open in it.
 *
 * Every open tab produces a row. A tab running no recognised agent still gets
 * one — empty `panes`, `voice: null`, `idle` — because the rail is the
 * sidebar's only list, and a tab the rail declines to draw is a tab the user
 * cannot reach from there.
 */
export function buildAgentRail(input: AgentRailInput): AgentRailView {
  const groups = filterRailToWorkspaceHistory(
    buildRail({
      tabs: input.tabs,
      activeIndex: input.activeIndex,
      scans: input.scans,
      collapsed: NO_COLLAPSED_REPOSITORIES,
      archivedPaths: NO_ARCHIVED_PATHS,
    }),
    input.workspaceHistoryPaths,
  );

  const clusters: RailStreamGroup[] = [];
  for (const group of groups) {
    const streamed: RailTabRow[] = [];
    for (const worktree of group.worktrees) {
      for (const railTab of worktree.tabs) {
        // Every tab of a project stays under that project, whatever its state.
        // A tab that wants the user used to be lifted into a pinned block,
        // which printed the project twice and moved the row out from under the
        // name the user was reading it by; the state mark carries the urgency
        // where the tab already is.
        streamed.push(tabRow(group, worktree, railTab, input));
      }
    }
    if (streamed.length > 0) {
      const rows = sortByOpenOrder(streamed);
      clusters.push({
        key: group.key,
        // The live tier's key IS the project identity: `scan.key` for a
        // repository, `plain:<path>` otherwise. No prefix, so the remembered
        // branch above can write the same string (spec §3).
        orderKey: group.key,
        project: group.name,
        labelled: streamed.length >= LOWEST_LABELLED_SIZE,
        rows,
        path: null,
        historyPaths: coveredHistoryPaths(group, input),
        // Ascending, not row order — a reading order. `closeTabs` pins every
        // entry by identity before its first dispose, so the order carries no
        // index-shift risk of its own.
        tabIndexes: [...rows.map((row) => row.index)].sort((a, b) => a - b),
      });
    }
  }

  // Live work first, in open order; the remembered tier is deduplicated
  // against every live worktree path, so a project never prints twice.
  const livePaths = groups
    .flatMap((group) => group.worktrees.map((worktree) => worktree.path))
    .filter((path) => path !== "");

  return {
    // The manual order is the LAST step over the assembled stream (spec §4):
    // a cluster the user dragged holds its slot across the live/remembered
    // boundary, and everything nobody has dragged keeps the order it always
    // had.
    stream: applyRailOrder(
      [...sortClusters(clusters), ...rememberedClusters(input, livePaths)],
      input.railOrder ?? NO_RAIL_ORDER,
      input.scans,
    ),
  };
}

/**
 * `2m`, `14m`, `3h`, `2d`, `5w` — short enough to sit in the row's right edge
 * beside the status mark, which is why this is not
 * `workspace-recents.ts`'s `formatRelativeTime` ("2 minutes ago"). That one
 * labels a list of folders and has the width for a sentence; this one shares a
 * column with a mark.
 *
 * Weeks are the largest unit on purpose: a pane older than that is not
 * something the rail is helping anyone return to, and `52w` still reads as
 * "a long time" without a second vocabulary.
 */
export function formatShortAge(then: number, now: number): string {
  if (then === 0) {
    // The tracker has never seen this pane's state change. Not "0m" — nothing
    // has happened, and a zero would claim it happened this second.
    return "";
  }
  const age = Math.max(0, now - then);
  if (age < MINUTE) {
    return "now";
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h`;
  }
  if (age < WEEK) {
    return `${Math.floor(age / DAY)}d`;
  }
  return `${Math.floor(age / WEEK)}w`;
}
