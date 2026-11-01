import { useMemo } from "preact/hooks";
import { repositoryScans } from "../../repositories/repositories-store";
import { sessionEntries } from "../../sessions/sessions-store";
import { settings } from "../../settings/settings-store";
import { paneTails } from "../../terminal/session-tail-store";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { buildAgentRail } from "../agent-rail-model";
import { sessionTitlesFor } from "../agent-rail-card-model";
import { isRailItemFocused } from "../project-rail/project-rail-model";
import { railItems, type RailItem } from "../rail-view-model";

export interface DockAgents {
  /** The rail row that holds the window's keyboard, or null when none does. */
  readonly focused: RailItem | null;
  /** The other agents of the focused agent's space (its tab); empty when it is alone or none is focused. */
  readonly space: readonly RailItem[];
}

const NONE: DockAgents = { focused: null, space: [] };

/**
 * Who the dock is about and who stands beside them. Built from the same inputs `AgentRail` feeds
 * `buildAgentRail`, so the dock and the rail name one agent the same way (identity, state, title).
 * Remembered projects add clusters with no rows, so the workspace history is left out.
 */
export function useDockAgents(): DockAgents {
  const tabs = tabViews.value;
  const activeIndex = activeTabIndex.value;
  const scans = repositoryScans.value;
  const tails = paneTails.value;
  const sessions = sessionEntries.value;
  const railOrder = settings.value.railOrder;
  return useMemo(() => {
    const items = railItems(
      buildAgentRail({
        tabs,
        activeIndex,
        scans,
        workspaceHistoryPaths: [],
        tails,
        titles: sessionTitlesFor(tabs, sessions),
        railOrder,
        now: Date.now(),
      }),
    );
    const focused = items.find(isRailItemFocused) ?? null;
    if (focused === null) {
      return NONE;
    }
    if (focused.entry.kind !== "agent") {
      return { focused, space: [] };
    }
    const tabIndex = focused.entry.tabIndex;
    // A space is a tab: its agents are the tab's agent panes, whichever checkout each stands in.
    const space = items.filter(
      (item) =>
        item.id !== focused.id && item.entry.kind === "agent" && item.entry.tabIndex === tabIndex,
    );
    return { focused, space };
  }, [tabs, activeIndex, scans, tails, sessions, railOrder]);
}
