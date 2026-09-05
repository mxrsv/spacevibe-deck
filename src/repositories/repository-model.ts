/**
 * The rail's view model: open tabs plus repository scans in, two tiers out.
 *
 * Pure, and deliberately so — it is where every grouping and state-precedence
 * decision lives, and none of them are observable from a screenshot. Groups
 * are built in first-appearance tab order and keyed per repository (the rule
 * `docs/internals/agent-rail.md` states under "Model"); a worktree's own state
 * precedence is missing > attention > working > ready/idle, decided by
 * `worktreeState` below. The component below it only renders what this
 * returns.
 */
import { workspaceLabel } from "../lib/workspace-label";
import type { PaneAgent } from "../lib/process-info";
import {
  type AgentAttentionSummary,
  type TabView,
  IDLE_ATTENTION_SUMMARY,
} from "../terminal/tabs-store";
import type { RepositoryScan } from "./repository-client";

export type WorktreeState = "missing" | "attention" | "working" | "ready" | "idle";

/** One open tab, carrying the index its callbacks need. */
export interface RailTab {
  readonly index: number;
  readonly key: number;
  /** Derived display name, for surfaces with no worktree to fall back on. */
  readonly label: string;
  /** The user's own name for this tab, if they set one. Overrides everything. */
  readonly customName: string | null;
  readonly workspacePath: string | null;
  readonly active: boolean;
  readonly agents: readonly PaneAgent[];
  readonly attention: AgentAttentionSummary;
  readonly agentBusy: boolean;
  readonly unread: boolean;
}

export interface WorktreeRow {
  readonly id: string;
  readonly path: string;
  /**
   * The BRANCH, not the directory basename.
   *
   * Two worktrees of one repository are told apart by their branch — the main
   * checkout's directory is usually named after the repository, so a basename
   * title would repeat the header above it and say nothing. A detached or
   * branch-less worktree falls back to the basename, which is then the only
   * name it has.
   */
  readonly name: string;
  readonly branch: string | null;
  /** git lists the main checkout first; that entry is the repository's own. */
  readonly primary: boolean;
  readonly state: WorktreeState;
  /** Lock reason, or "" when locked without one. Null means not locked. */
  readonly locked: string | null;
  /** Open tabs on this worktree, in tab order. Empty means not open. */
  readonly tabs: readonly RailTab[];
  /** Agents present anywhere in the worktree, deduplicated in tab/pane order. */
  readonly agents: readonly PaneAgent[];
  /**
   * Empty row with an archived session (`session-journal.ts`'s
   * `sessionArchive`): a pressable "resume" row, not a readout. False
   * whenever `tabs` is non-empty — a live worktree resumes nothing.
   */
  readonly resumable: boolean;
}

export interface RepositoryGroup {
  /** The repository's common dir, or `plain:<path>` for a folder. */
  readonly key: string;
  readonly kind: "repository" | "plain";
  readonly name: string;
  readonly collapsed: boolean;
  readonly worktrees: readonly WorktreeRow[];
}

export interface RailInput {
  readonly tabs: readonly TabView[];
  readonly activeIndex: number;
  /** Scan result per workspace path, as far as scanning has got. */
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  /** Repository keys the user has collapsed. */
  readonly collapsed: ReadonlySet<string>;
  /** Workspace paths with an archived session — their empty rows become pressable. */
  readonly archivedPaths: ReadonlySet<string>;
}

const NO_COLLAPSED_REPOSITORIES: ReadonlySet<string> = new Set();
const NO_ARCHIVED_PATHS: ReadonlySet<string> = new Set();

function tabOf(tab: TabView, index: number, activeIndex: number): RailTab {
  return {
    index,
    key: tab.key,
    label: tab.name ?? (tab.workspacePath === null ? "Unknown" : workspaceLabel(tab.workspacePath)),
    customName: tab.name,
    workspacePath: tab.workspacePath,
    active: index === activeIndex,
    agents: tab.agents,
    attention: tab.attention ?? IDLE_ATTENTION_SUMMARY,
    agentBusy: tab.agentBusy,
    unread: tab.unread,
  };
}

function agentsForTabs(tabs: readonly RailTab[]): readonly PaneAgent[] {
  return [...new Set(tabs.flatMap((tab) => tab.agents))];
}

/**
 * The worktree a workspace path belongs to.
 *
 * Longest prefix wins, because a tab opened on `repo/packages/web` belongs to
 * `repo`, not to nothing — and if `repo/packages/web` is itself a worktree, the
 * longer path is the right answer. A plain `startsWith` would attach
 * `/repo-two` to `/repo`, so the boundary has to be a separator or the end.
 */
export function worktreeForPath(paths: readonly string[], workspacePath: string): string | null {
  let best: string | null = null;
  for (const candidate of paths) {
    if (
      workspacePath === candidate ||
      workspacePath.startsWith(`${candidate}/`) ||
      workspacePath.startsWith(`${candidate}\\`)
    ) {
      if (best === null || candidate.length > best.length) {
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * Which of `worktreePaths` an archived session lights up.
 *
 * Archive keys (`session-journal.ts`'s `sessionArchive`) are workspace
 * paths, exactly like tab workspace paths — an entry recorded on a
 * subdirectory still owns its worktree, so this reuses `worktreeForPath`'s
 * longest-prefix match rather than an exact-path check.
 */
function resumableWorktreePaths(
  archivedPaths: ReadonlySet<string>,
  worktreePaths: readonly string[],
): ReadonlySet<string> {
  return new Set(
    [...archivedPaths]
      .map((path) => worktreeForPath(worktreePaths, path))
      .filter((path): path is string => path !== null),
  );
}

/**
 * Keep current sessions plus worktrees represented in Deck's persisted
 * workspace history. Git discovery supplies metadata; it does not decide
 * which never-opened siblings become navigation rows.
 */
export function filterRailToWorkspaceHistory(
  groups: readonly RepositoryGroup[],
  workspaceHistoryPaths: readonly string[],
): readonly RepositoryGroup[] {
  return groups.flatMap((group) => {
    const worktreePaths = group.worktrees.map((worktree) => worktree.path);
    const historicalWorktrees = new Set(
      workspaceHistoryPaths
        .map((path) => worktreeForPath(worktreePaths, path))
        .filter((path): path is string => path !== null),
    );
    const worktrees = group.worktrees.filter(
      (worktree) => worktree.tabs.length > 0 || historicalWorktrees.has(worktree.path),
    );
    return worktrees.length === 0 ? [] : [{ ...group, worktrees }];
  });
}

/**
 * State precedence, highest first: `missing` before everything.
 *
 * A worktree git calls prunable is gone from disk, and that is a fact about
 * the machine rather than about the session — it outranks a busy agent,
 * because the agent is busy inside a directory that no longer exists. The row
 * keeps its tabs either way (§5: a row with an open tab never vanishes).
 */
function worktreeState(prunable: string | null, tabs: readonly RailTab[]): WorktreeState {
  if (prunable !== null) {
    return "missing";
  }
  if (tabs.some((tab) => tab.attention.actionableCount > 0)) {
    return "attention";
  }
  if (tabs.some((tab) => tab.agentBusy)) {
    return "working";
  }
  return tabs.length > 0 ? "ready" : "idle";
}

/**
 * Build the rail.
 *
 * Group order follows first appearance in tab order, so the rail does not
 * reshuffle itself when a scan lands: a repository's position is decided by
 * the tab that introduced it, and a later scan only fills the group in.
 */
export function buildRail(input: RailInput): readonly RepositoryGroup[] {
  const railTabs = input.tabs.map((tab, index) => tabOf(tab, index, input.activeIndex));

  // One entry per group, in first-appearance order.
  const order: string[] = [];
  const scanByKey = new Map<string, RepositoryScan & { kind: "repository" }>();
  const tabsByKey = new Map<string, RailTab[]>();

  for (const tab of railTabs) {
    const scan = tab.workspacePath === null ? undefined : input.scans.get(tab.workspacePath);
    const key =
      scan !== undefined && scan.kind === "repository"
        ? scan.key
        : `plain:${tab.workspacePath ?? `unknown-${tab.key}`}`;
    if (!tabsByKey.has(key)) {
      tabsByKey.set(key, []);
      order.push(key);
    }
    tabsByKey.get(key)!.push(tab);
    if (scan !== undefined && scan.kind === "repository" && !scanByKey.has(key)) {
      scanByKey.set(key, scan);
    }
  }

  return order.map((key) => {
    const groupTabs = tabsByKey.get(key) ?? [];
    const scan = scanByKey.get(key);
    if (scan === undefined) {
      // A folder Deck cannot resolve as a repository, or a scan that has not
      // landed yet. One synthetic worktree row so the tab still has a home —
      // this is the flat list Deck shows today, wearing the rail's clothes.
      const path = groupTabs[0]?.workspacePath ?? "";
      const resumable = resumableWorktreePaths(input.archivedPaths, path === "" ? [] : [path]);
      return {
        key,
        kind: "plain" as const,
        name: path === "" ? (groupTabs[0]?.label ?? "Unknown") : workspaceLabel(path),
        collapsed: input.collapsed.has(key),
        worktrees: [
          {
            id: key,
            path,
            name: path === "" ? (groupTabs[0]?.label ?? "Unknown") : workspaceLabel(path),
            branch: null,
            primary: true,
            state: worktreeState(null, groupTabs),
            locked: null,
            tabs: groupTabs,
            agents: agentsForTabs(groupTabs),
            resumable: groupTabs.length === 0 && resumable.has(path),
          },
        ],
      };
    }

    // A bare entry has no working directory, so it is not somewhere a session
    // can run and it is not a row.
    const entries = scan.worktrees.filter((entry) => !entry.bare);
    const paths = entries.map((entry) => entry.path);
    const resumable = resumableWorktreePaths(input.archivedPaths, paths);
    // One longest-prefix resolution per TAB, bucketed — not one per
    // (worktree x tab), which re-scanned every worktree path for each pair.
    const tabsByWorktree = new Map<string, typeof groupTabs>();
    for (const tab of groupTabs) {
      if (tab.workspacePath === null) {
        continue;
      }
      const owner = worktreeForPath(paths, tab.workspacePath);
      if (owner === null) {
        continue;
      }
      const bucket = tabsByWorktree.get(owner);
      if (bucket === undefined) {
        tabsByWorktree.set(owner, [tab]);
      } else {
        bucket.push(tab);
      }
    }
    return {
      key,
      kind: "repository" as const,
      // Named after the repository's own checkout — the first entry git
      // reports — not after whichever worktree happened to be opened first.
      name: workspaceLabel(entries[0]?.path ?? scan.root),
      collapsed: input.collapsed.has(key),
      worktrees: entries.map((entry, index) => {
        const tabs = tabsByWorktree.get(entry.path) ?? [];
        return {
          id: `${key}:${entry.path}`,
          path: entry.path,
          name: entry.branch ?? workspaceLabel(entry.path),
          branch: entry.branch,
          primary: index === 0,
          state: worktreeState(entry.prunable, tabs),
          resumable: tabs.length === 0 && resumable.has(entry.path),
          locked: entry.locked,
          tabs,
          agents: agentsForTabs(tabs),
        };
      }),
    };
  });
}

/**
 * Global tab indexes belonging to the worktree that owns `activeIndex`.
 *
 * The sidebar and its stage strip must derive identity through the same rail
 * model: exact `workspacePath` equality is not enough when a tab runs from a
 * package below a worktree root. Returning global indexes keeps every existing
 * tab callback on `TabManager`'s coordinate system while presentation is
 * scoped to the selected row.
 */
export function activeWorktreeTabIndexes(
  tabs: readonly TabView[],
  activeIndex: number,
  scans: ReadonlyMap<string, RepositoryScan>,
): readonly number[] {
  const groups = buildRail({
    tabs,
    activeIndex,
    scans,
    collapsed: NO_COLLAPSED_REPOSITORIES,
    archivedPaths: NO_ARCHIVED_PATHS,
  });
  for (const group of groups) {
    const activeWorktree = group.worktrees.find((worktree) =>
      worktree.tabs.some((tab) => tab.active),
    );
    if (activeWorktree !== undefined) {
      return activeWorktree.tabs.map((tab) => tab.index);
    }
  }
  return [];
}

/**
 * Global tab indexes belonging to the REPOSITORY that owns `activeIndex`.
 *
 * The sibling of `activeWorktreeTabIndexes`, and the one the stage strip uses
 * since 2026-08-16: the agent rail's unit is a tab in a project, not a
 * checkout, so scoping the strip by worktree would hide a sibling tab of the
 * same project the rail is still listing. 46 of 51 repositories in the
 * measured corpus have exactly one working directory, so for almost every
 * project the two answers are identical — the difference only shows up in the
 * handful of repositories that really do run several worktrees, and there the
 * project is the unit the rail agreed on: the active repository's tab indexes
 * are what the sidebar strip scopes to (`docs/internals/agent-rail.md`).
 *
 * Both functions stay: this one is a change to what the STRIP scopes by, not
 * a claim that a worktree stopped being a real grouping — `buildRail` still
 * groups by it, and the rail still names it as a row suffix.
 */
export function activeRepositoryTabIndexes(
  tabs: readonly TabView[],
  activeIndex: number,
  scans: ReadonlyMap<string, RepositoryScan>,
): readonly number[] {
  const groups = buildRail({
    tabs,
    activeIndex,
    scans,
    collapsed: NO_COLLAPSED_REPOSITORIES,
    archivedPaths: NO_ARCHIVED_PATHS,
  });
  for (const group of groups) {
    const tabsInGroup = group.worktrees.flatMap((worktree) => worktree.tabs);
    if (tabsInGroup.some((tab) => tab.active)) {
      // Tab order, not worktree order: the strip paints one row of chips and
      // its left-to-right order must match `TabManager`'s own, or ⌘1..⌘9 and
      // the visible sequence disagree.
      return tabsInGroup.map((tab) => tab.index).sort((left, right) => left - right);
    }
  }
  return [];
}
