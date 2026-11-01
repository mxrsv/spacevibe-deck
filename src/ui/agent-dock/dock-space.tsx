import { useEffect } from "preact/hooks";
import { AgentStateMark } from "../blocks/agent-state-mark";
import { displayAgent } from "../agent-rail-card-model";
import { formatShortAge } from "../agent-rail-model";
import { AgentGlyph } from "../controls/agent-glyph";
import { Button } from "../controls/button";
import { railNow, runRailClock } from "../project-rail/project-rail-state";
import {
  selectRailItem,
  statusLabel,
  type RailSelection,
} from "../project-rail/project-rail-model";
import type { RailItem } from "../rail-view-model";
import { DockSection } from "./dock-section";

export interface DockSpaceProps {
  /** The other agents of the focused agent's space. */
  readonly agents: readonly RailItem[];
  readonly selection: RailSelection;
}

/** Time in the current state. Its own component so a clock tick wakes this text and no row. */
function StateAge({ changedAt }: { readonly changedAt: number }) {
  return <>{formatShortAge(changedAt, railNow.value)}</>;
}

/**
 * The other agents of the focused agent's space (LAY-6): state, agent, what it is doing, its branch
 * and how long it has been so. A row takes the keyboard to that agent's pane, as a rail row does.
 * Left out when the space holds no other agent.
 */
export function DockSpace({ agents, selection }: DockSpaceProps) {
  const present = agents.length > 0;
  // The age is minutes-coarse; the clock only runs while there is a row to read it.
  useEffect(() => (present ? runRailClock() : undefined), [present]);
  if (!present) {
    return null;
  }
  return (
    <DockSection id="space" title="In this space" count={String(agents.length)}>
      <ul className="p-1">
        {agents.map((item) => (
          <li key={item.id}>
            <Button
              variant="ghost"
              className="h-auto w-full justify-start px-2 py-1.5"
              onClick={() => selectRailItem(item, selection)}
            >
              <span className="grid w-full min-w-0 grid-cols-[10px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-left">
                <span className="flex h-[18px] items-center">
                  <AgentStateMark status={item.status} confidence={item.confidence} />
                </span>
                <span className="truncate text-xs font-normal text-foreground">{item.title}</span>
                <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-2xs font-normal text-muted-foreground">
                  {item.entry.kind === "agent" ? (
                    <AgentGlyph agent={item.entry.agent} className="size-3 shrink-0" />
                  ) : null}
                  <span className="truncate" aria-hidden="true">
                    {item.entry.kind === "agent" ? `${displayAgent(item.entry.agent)} · ` : ""}
                    {item.branch}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums">
                    <StateAge changedAt={item.changedAt} />
                  </span>
                </span>
                <span className="sr-only">
                  {item.entry.kind === "agent" ? `${displayAgent(item.entry.agent)}, ` : ""}
                  {statusLabel(item)}
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </DockSection>
  );
}
