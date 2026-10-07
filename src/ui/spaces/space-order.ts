/**
 * The order spaces are drawn in (DL-35.3, owner 2026-09-29): the rail's own,
 * top to bottom — project clusters in the order the user dragged them, each
 * checkout's tabs under it. The marks, ⌘1–9, cycling, the swipe and Mission
 * Control's shelf all read this one list, so a mark sits where its tab sits in
 * the sidebar and never moves because something else was opened.
 */
import { workspacesData } from "../../open-board/workspaces-store";
import { repositoryScans } from "../../repositories/repositories-store";
import { activeRepositoryTabIndexes } from "../../repositories/repository-model";
import { settings } from "../../settings/settings-store";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { buildAgentRail, type AgentRailInput } from "../agent-rail-model";

export type SpaceOrderInput = Omit<AgentRailInput, "now" | "tails" | "models">;

/** The project a space belongs to: the rail's stable identity and its printed name. */
export interface SpaceGroup {
  /** `RailStreamGroup.orderKey` — a repository and its worktrees share it. */
  readonly key: string;
  readonly label: string;
}

export interface SpaceLayout {
  /** Owner tab indexes in rail order; a tab the rail does not list goes last. */
  readonly order: readonly number[];
  /** Owner tab index → its project; absent for a tab the rail does not list. */
  readonly groups: ReadonlyMap<number, SpaceGroup>;
}

/**
 * One `buildAgentRail` call yields the order and each tab's project, so the
 * grouping the strip, the shelf and the sidebar draw cannot drift from the
 * order they are drawn in (DL-35.3).
 */
export function spaceLayoutFromRail(input: SpaceOrderInput): SpaceLayout {
  // The clock only formats ages, which no index depends on.
  const view = buildAgentRail({ ...input, now: 0 });
  const groups = new Map<number, SpaceGroup>();
  const listed: number[] = [];
  for (const group of view.stream) {
    for (const worktree of group.worktrees) {
      for (const row of worktree.rows) {
        if (row.index < 0 || row.index >= input.tabs.length || groups.has(row.index)) continue;
        groups.set(row.index, { key: group.orderKey, label: group.project });
        listed.push(row.index);
      }
    }
  }
  const unlisted = input.tabs.flatMap((_, index) => (groups.has(index) ? [] : [index]));
  return { order: [...listed, ...unlisted], groups };
}

/** Owner tab indexes in rail order. */
export function spaceOrderFromRail(input: SpaceOrderInput): readonly number[] {
  return spaceLayoutFromRail(input).order;
}

/** `spaceLayoutFromRail` over the window's live stores. */
export function currentSpaceLayout(): SpaceLayout {
  return spaceLayoutFromRail({
    tabs: tabViews.value,
    activeIndex: activeTabIndex.value,
    scans: repositoryScans.value,
    workspaceHistoryPaths: workspacesData.value.recents.map((recent) => recent.path),
    railOrder: settings.value.railOrder,
  });
}

/** The order alone, for callers that draw nothing by project. */
export function currentSpaceOrder(): readonly number[] {
  return currentSpaceLayout().order;
}

/**
 * The current project's spaces in rail order (DL-35.3, amended 2026-10-07):
 * the marks the strip draws once scoped to the active repository, so ⌘1–9,
 * cycling and the swipe keep counting what is drawn. Other projects are
 * reached through the rail.
 */
export function currentProjectSpaceOrder(): readonly number[] {
  const scoped = new Set(
    activeRepositoryTabIndexes(tabViews.value, activeTabIndex.value, repositoryScans.value),
  );
  return currentSpaceOrder().filter((index) => scoped.has(index));
}
