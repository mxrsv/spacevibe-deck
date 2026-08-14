/**
 * The rail's view model: open tabs plus repository scans in, two tiers out.
 *
 * Pure, and deliberately so — it is where every grouping and state-precedence
 * decision in
 * `docs/specs/2026-08-13-repository-worktree-rail-design.md` §4/§6.1 lives, and
 * none of them are observable from a screenshot. The component below it only
 * renders what this returns.
 */
import { workspaceLabel } from "../lib/workspace-label";
import type { PaneAgent } from "../lib/process-info";
import type { AgentAttentionSummary, TabView } from "../terminal/tabs-store";
import { IDLE_ATTENTION_SUMMARY } from "../terminal/tabs-store";
import type { RepositoryScan } from "./repository-client";

export type WorktreeState =
  | "missing"
  | "attention"
  | "working"
  | "ready"
  | "idle";

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
}

function tabOf(tab: TabView, index: number, activeIndex: number): RailTab {
  return {
    index,
    key: tab.key,
    label:
      tab.name ??
      (tab.workspacePath === null ? "Unknown" : workspaceLabel(tab.workspacePath)),
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
export function worktreeForPath(
  paths: readonly string[],
  workspacePath: string,
): string | null {
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
 * State precedence, highest first: `missing` before everything.
 *
 * A worktree git calls prunable is gone from disk, and that is a fact about
 * the machine rather than about the session — it outranks a busy agent,
 * because the agent is busy inside a directory that no longer exists. The row
 * keeps its tabs either way (§5: a row with an open tab never vanishes).
 */
function worktreeState(
  prunable: string | null,
  tabs: readonly RailTab[],
): WorktreeState {
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
  const railTabs = input.tabs.map((tab, index) =>
    tabOf(tab, index, input.activeIndex),
  );

  // One entry per group, in first-appearance order.
  const order: string[] = [];
  const scanByKey = new Map<string, RepositoryScan & { kind: "repository" }>();
  const tabsByKey = new Map<string, RailTab[]>();

  for (const tab of railTabs) {
    const scan =
      tab.workspacePath === null ? undefined : input.scans.get(tab.workspacePath);
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
          },
        ],
      };
    }

    // A bare entry has no working directory, so it is not somewhere a session
    // can run and it is not a row.
    const entries = scan.worktrees.filter((entry) => !entry.bare);
    const paths = entries.map((entry) => entry.path);
    return {
      key,
      kind: "repository" as const,
      // Named after the repository's own checkout — the first entry git
      // reports — not after whichever worktree happened to be opened first.
      name: workspaceLabel(entries[0]?.path ?? scan.root),
      collapsed: input.collapsed.has(key),
      worktrees: entries.map((entry, index) => {
        const tabs = groupTabs.filter(
          (tab) =>
            tab.workspacePath !== null &&
            worktreeForPath(paths, tab.workspacePath) === entry.path,
        );
        return {
          id: `${key}:${entry.path}`,
          path: entry.path,
          name: entry.branch ?? workspaceLabel(entry.path),
          branch: entry.branch,
          primary: index === 0,
          state: worktreeState(entry.prunable, tabs),
          locked: entry.locked,
          tabs,
          agents: agentsForTabs(tabs),
        };
      }),
    };
  });
}
