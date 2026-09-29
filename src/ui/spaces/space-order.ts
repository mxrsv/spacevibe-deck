/**
 * The order spaces are drawn in (DL-35.3, owner 2026-09-29): the rail's own,
 * top to bottom — project clusters in the order the user dragged them, each
 * checkout's tabs under it. The marks, ⌘1–9, cycling, the swipe and Mission
 * Control's shelf all read this one list, so a mark sits where its tab sits in
 * the sidebar and never moves because something else was opened.
 */
import { workspacesData } from "../../open-board/workspaces-store";
import { repositoryScans } from "../../repositories/repositories-store";
import { settings } from "../../settings/settings-store";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { buildAgentRail, type AgentRailInput } from "../agent-rail-model";

export type SpaceOrderInput = Omit<AgentRailInput, "now" | "tails" | "models">;

/** Owner tab indexes in rail order; a tab the rail does not list goes last. */
export function spaceOrderFromRail(input: SpaceOrderInput): readonly number[] {
  // The clock only formats ages, which no index depends on.
  const view = buildAgentRail({ ...input, now: 0 });
  const listed = [
    ...new Set(
      view.stream.flatMap((group) =>
        group.worktrees.flatMap((worktree) => worktree.rows.map((row) => row.index)),
      ),
    ),
  ].filter((index) => index >= 0 && index < input.tabs.length);
  const seen = new Set(listed);
  return [...listed, ...input.tabs.flatMap((_, index) => (seen.has(index) ? [] : [index]))];
}

/** `spaceOrderFromRail` over the window's live stores. */
export function currentSpaceOrder(): readonly number[] {
  return spaceOrderFromRail({
    tabs: tabViews.value,
    activeIndex: activeTabIndex.value,
    scans: repositoryScans.value,
    workspaceHistoryPaths: workspacesData.value.recents.map((recent) => recent.path),
    railOrder: settings.value.railOrder,
  });
}
