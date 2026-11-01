import { useMemo } from "preact/hooks";
import type { AgentRailView } from "../agent-rail-model";
import { AgentStateMark } from "../blocks/agent-state-mark";
import { Button } from "../controls/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { needsYouItems, nextNeedsYou } from "./project-rail-attention";
import { selectRailItem, type RailSelection } from "./project-rail-model";
import { unfoldProject } from "./project-rail-state";

export interface ProjectRailAttentionPillProps extends RailSelection {
  /** The view `AgentRail` builds: the pill counts its unpartitioned rows. */
  readonly view: AgentRailView;
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
  onFocusPane,
  onSelectTab,
}: ProjectRailAttentionPillProps) {
  const count = useMemo(() => needsYouItems(view).length, [view]);
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
