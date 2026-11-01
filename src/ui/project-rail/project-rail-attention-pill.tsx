import { useMemo } from "preact/hooks";
import { workspacesData } from "../../open-board/workspaces-store";
import { repositoryScans } from "../../repositories/repositories-store";
import { settings } from "../../settings/settings-store";
import { paneTails } from "../../terminal/session-tail-store";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { buildAgentRail, type AgentRailView } from "../agent-rail-model";
import { AgentStateMark } from "../blocks/agent-state-mark";
import { Button } from "../controls/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { needsYouItems, nextNeedsYou } from "./project-rail-attention";
import { selectRailItem, type RailSelection } from "./project-rail-model";
import { unfoldProject } from "./project-rail-state";

export interface ProjectRailAttentionPillProps extends RailSelection {
  /** The view `AgentRail` builds: the pill counts its unpartitioned rows. */
  readonly view: AgentRailView;
  /** The stage bar's form: the state mark and the count, no words. */
  readonly compact?: boolean;
}

/**
 * "N need you" (LAY-3): one pill that says how many agents ask for the user and sends them to
 * the next, wrapping around. It counts every such row, including those of hidden projects,
 * archived rows and folded projects, and is absent at zero. A press goes through the host's
 * pane-exact focus (`onFocusPane`), the preflight ⌘⇧A runs too, then unfolds the target's
 * project so the row it landed on is on screen. ⌘⇧A keeps its own jump (decision F4: severity
 * first, finished runs included, no wrap), so the tooltip names no chord: it would promise a
 * behaviour this press does not have.
 */
export function ProjectRailAttentionPill({
  view,
  compact = false,
  onFocusPane,
  onSelectTab,
}: ProjectRailAttentionPillProps) {
  const items = useMemo(() => needsYouItems(view), [view]);
  const count = items.length;
  if (count === 0) {
    return null;
  }
  const jump = (): void => {
    const next = nextNeedsYou(view);
    if (next === null) {
      return;
    }
    unfoldProject(next.projectKey);
    selectRailItem(next, { onFocusPane, onSelectTab });
  };
  if (compact) {
    // A question and a failure count together; the mark takes the louder of the two.
    const status = items.some((item) => item.status === "failed") ? "failed" : "needs-input";
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              aria-label={`${count} ${count === 1 ? "agent needs" : "agents need"} you`}
              className="tabular-nums"
              onClick={jump}
            />
          }
        >
          <AgentStateMark status={status} />
          <span aria-hidden="true">{count}</span>
        </TooltipTrigger>
        <TooltipContent>Next agent that needs you</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="secondary" size="sm" onClick={jump} />}>
        <AgentStateMark status="needs-input" />
        {count} need you
      </TooltipTrigger>
      <TooltipContent>Next</TooltipContent>
    </Tooltip>
  );
}

/**
 * The pill as the stage bar mounts it: the view built from the same window stores the rail
 * reads, so the count and the rail cannot disagree. Titles are left out (the pill reads status
 * and entry only). Wrapped in `.ui-preset` because the bar is not a preset surface.
 */
export function StageAttentionPill({ onFocusPane, onSelectTab }: RailSelection) {
  const tabs = tabViews.value;
  const activeIndex = activeTabIndex.value;
  const scans = repositoryScans.value;
  const recents = workspacesData.value.recents;
  const tails = paneTails.value;
  const railOrder = settings.value.railOrder;
  const view = useMemo(
    () =>
      buildAgentRail({
        tabs,
        activeIndex,
        scans,
        workspaceHistoryPaths: recents.map((recent) => recent.path),
        tails,
        railOrder,
        now: Date.now(),
      }),
    [tabs, activeIndex, scans, recents, tails, railOrder],
  );
  return (
    <span className="ui-preset flex shrink-0 items-center bg-transparent empty:hidden">
      <ProjectRailAttentionPill
        view={view}
        compact
        onFocusPane={onFocusPane}
        onSelectTab={onSelectTab}
      />
    </span>
  );
}
