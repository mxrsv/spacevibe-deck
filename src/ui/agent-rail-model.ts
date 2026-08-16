/**
 * The agent rail's view model: open tabs, repository scans and the session
 * archive in, one list of per-project clusters out.
 *
 * Pure, and for the same reason
 * [`repository-model.ts`](../repositories/repository-model.ts) `current` is:
 * every precedence, fold and ordering decision in
 * `docs/specs/2026-08-16-agent-status-rail-design.md` §2/§3/§8 lives here and
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
import type { RepositoryScan } from "../repositories/repository-client";
import type {
  RailTab,
  RepositoryGroup,
  WorktreeRow,
} from "../repositories/repository-model";
import {
  buildRail,
  filterRailToWorkspaceHistory,
  worktreeForPath,
} from "../repositories/repository-model";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { NO_PANES } from "../terminal/tabs-store";
import { UNSEQUENCED } from "../lib/open-sequence";

/** Spec §3. `failed` is new relative to the gallery specimen. */
export type RailState = "failed" | "asked" | "done" | "working" | "resting";

/** One agent pane inside a tab row. */
export interface RailPaneRow {
  readonly paneId: number;
  readonly agent: PaneAgent;
  readonly state: RailState;
  /** Head of the newest turn. The tab's title until tier 3 lands. */
  readonly message: string;
  readonly changedAt: number;
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
   * `shell`. Rendered in place of `project` inside a labelled cluster (§2.4).
   */
  readonly identity: string;
  /** Rendered only when the tab is NOT in the repository's primary checkout. */
  readonly worktree: string | null;
  /** The tab's own label (custom name, else workspace label). */
  readonly title: string;
  /**
   * The line under the row: the newest turn, or empty when there is nothing to
   * say that the row has not already said (§2.4).
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

/** A previously opened workspace with an archived session and no live tab. */
export interface RailArchivedRow {
  readonly path: string;
  readonly project: string;
  readonly worktree: string | null;
}

/**
 * One project's stretch of the stream (§2.4).
 *
 * The stream is grouped rather than flat because the project name is the
 * loudest word in a row and N tabs in one project printed it N times, scattered
 * by recency. Grouping moves the name up one level; it does NOT reinstate the
 * repository → worktree tree §9 rules out — a cluster has no state, no age, no
 * disclosure and nothing to press, and the worktree stays a suffix on the row.
 *
 * Since 2026-08-16 a cluster holds EVERY tab of its project, including the ones
 * waiting on the user: the pinned block that used to lift those out is gone, so
 * a project is printed in exactly one place and its tabs are all under it.
 */
export interface RailStreamGroup {
  /** `RepositoryGroup.key` — list identity. */
  readonly key: string;
  /** The project name, printed once above the rows. */
  readonly project: string;
  /**
   * Whether the header is printed at all. A cluster of one prints no header
   * and its row names the project itself: most projects have exactly one tab,
   * and a header per row would double the rail's height to say what the row
   * already says.
   */
  readonly labelled: boolean;
  readonly rows: readonly RailTabRow[];
}

export interface AgentRailView {
  /** Every open tab, clustered by project, in the order things were opened. */
  readonly stream: readonly RailStreamGroup[];
  /** Quiet resume rows at the bottom (spec §8). */
  readonly archived: readonly RailArchivedRow[];
}

export interface AgentRailInput {
  readonly tabs: readonly TabView[];
  readonly activeIndex: number;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  /** Workspace paths with an archived session. */
  readonly archivedPaths: ReadonlySet<string>;
  /** Deck's persisted workspace history, newest first. */
  readonly workspaceHistoryPaths: readonly string[];
  /** Injected clock — the model never calls `Date.now()` itself. */
  readonly now: number;
}

/** DL-27.3's precedence, as numbers, so the fold has one comparison to make. */
const STATE_RANK: Readonly<Record<RailState, number>> = {
  failed: 4,
  asked: 3,
  done: 2,
  working: 1,
  resting: 0,
};

/** The rail has no collapse affordance — it is one flat list (spec §2). */
const NO_COLLAPSED_REPOSITORIES: ReadonlySet<string> = new Set();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Spec §3's mapping, exactly.
 *
 * Attention is read BEFORE phase: the tracker latches attention and leaves
 * phase live, so a pane can be `working` while carrying a warning nobody has
 * answered, and the latched state is the one the user has to act on.
 * `warning` folds into `asked` (§4.6) — both mean "come look", and the palette
 * stays three marks wide rather than four.
 */
function paneState(pane: PaneView): RailState {
  switch (pane.attention) {
    case "error":
      return "failed";
    case "requested":
    case "warning":
      return "asked";
    case "completed":
      return "done";
    default:
      return pane.phase === "working" ? "working" : "resting";
  }
}

/**
 * The agent panes of one tab, in pane order.
 *
 * Shell and test-runner panes are dropped here and nowhere else: spec §9 says
 * the rail answers "which agent", so they are not rows — but they remain part
 * of the tab, which is why `tabs-store.ts` reports every pane and the filter
 * lives with the surface instead.
 */
function paneRows(tab: TabView | undefined, message: string): RailPaneRow[] {
  return (tab?.panes ?? NO_PANES).flatMap((pane) =>
    pane.agent === null
      ? []
      : [
          {
            paneId: pane.paneId,
            agent: pane.agent,
            message,
            state: paneState(pane),
            changedAt: pane.changedAt,
          },
        ],
  );
}

/**
 * The turn under a row, while tier 3 (`session_tail`) is not built.
 *
 * §5 makes the tab title the fallback, and `label` is that title — but a tab
 * nobody renamed derives its label from its own workspace path, so the fallback
 * printed the project name again, once under the row and once under every pane
 * inside it. Only the name a PERSON typed says something the row has not: a
 * derived label repeating the line above it is not a turn, so the row stays one
 * line high until a real turn exists to put there.
 */
function messageOf(railTab: RailTab): string {
  return railTab.customName ?? "";
}

/**
 * What a row is called inside a labelled cluster, in order of how much it says:
 * the user's own tab name, else the agents running in it, else `shell` — a tab
 * with no recognised agent is a shell, and saying so beats repeating the
 * project name the header above already carries.
 */
function identityOf(railTab: RailTab, panes: readonly RailPaneRow[]): string {
  if (railTab.customName !== null && railTab.customName !== "") {
    return railTab.customName;
  }
  return panes.length === 0
    ? "shell"
    : panes.map((pane) => pane.agent).join(" + ");
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
  const message = messageOf(railTab);
  const tab = input.tabs[railTab.index];
  const panes = paneRows(tab, message);
  const voice = loudestPane(panes);
  const state = voice?.state ?? "resting";
  // Agent panes only: a tab whose shells have been busy all morning has still
  // said nothing an agent rail can report, so its age stays empty.
  const changedAt = panes.reduce(
    (newest, pane) => Math.max(newest, pane.changedAt),
    0,
  );
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
function sortClusters(
  groups: readonly RailStreamGroup[],
): readonly RailStreamGroup[] {
  return [...groups].sort(
    (left, right) =>
      openedFirst(left) - openedFirst(right) || firstOf(left) - firstOf(right),
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
  return group.rows.reduce(
    (lowest, row) => Math.min(lowest, row.index),
    Number.MAX_SAFE_INTEGER,
  );
}

/** A cluster of one prints no header; its row names the project itself. */
const LOWEST_LABELLED_SIZE = 2;

/**
 * How recently the user opened a worktree, as a position in Deck's persisted
 * history (0 is newest).
 *
 * Prefix-matched rather than compared by path: a history entry recorded on a
 * package below the root still names its worktree, exactly as
 * `filterRailToWorkspaceHistory` treats it.
 */
function historyRank(
  workspaceHistoryPaths: readonly string[],
  worktreePaths: readonly string[],
  path: string,
): number {
  const rank = workspaceHistoryPaths.findIndex(
    (entry) => worktreeForPath(worktreePaths, entry) === path,
  );
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

/**
 * Spec §8: a previously opened workspace with an archived session and no live
 * tab, as a quiet resume row. `buildRail` already decides `resumable` — this
 * only orders them the way the stream above is ordered, newest first.
 */
function archivedRows(
  groups: readonly RepositoryGroup[],
  workspaceHistoryPaths: readonly string[],
): readonly RailArchivedRow[] {
  const ranked: { readonly row: RailArchivedRow; readonly rank: number }[] = [];
  for (const group of groups) {
    const worktreePaths = group.worktrees.map((worktree) => worktree.path);
    for (const worktree of group.worktrees) {
      if (!worktree.resumable) {
        continue;
      }
      ranked.push({
        row: {
          path: worktree.path,
          project: group.name,
          worktree: worktree.primary ? null : worktree.name,
        },
        rank: historyRank(workspaceHistoryPaths, worktreePaths, worktree.path),
      });
    }
  }
  return ranked
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.row);
}

/**
 * Build the rail: one cluster per project in open order, and the resume rows
 * below.
 *
 * Every open tab produces a row. A tab running no recognised agent still gets
 * one — empty `panes`, `voice: null`, `resting` — because the rail is the
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
      archivedPaths: input.archivedPaths,
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
      clusters.push({
        key: group.key,
        project: group.name,
        labelled: streamed.length >= LOWEST_LABELLED_SIZE,
        rows: sortByOpenOrder(streamed),
      });
    }
  }

  return {
    stream: sortClusters(clusters),
    archived: archivedRows(groups, input.workspaceHistoryPaths),
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
