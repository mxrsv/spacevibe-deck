import { USAGE_AGENT_LABEL, USAGE_AGENT_ORDER } from "../usage/usage-format";
import {
  limitControlName,
  readAgentLimit,
  type AgentUsageSummaryProps,
} from "../usage/agent-usage-summary";
import { UsageRing } from "../blocks/usage-ring";
import { AgentGlyph } from "../controls/agent-glyph";
import { Button } from "../controls/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";

/**
 * The foot's view of the agent limits: one ring per agent around its logo, filled with what is
 * left. The control keeps the name and every window of the shipped text line, in its tooltip
 * and its accessible name; a press opens Usage.
 */
export function ProjectRailUsageRings({
  onOpenUsage,
  snapshot = [],
  nowMs = Date.now(),
}: AgentUsageSummaryProps) {
  return (
    <section className="flex items-center gap-0.5" aria-label="Agent limits">
      {USAGE_AGENT_ORDER.map((agent) => {
        const { remaining, detail } = readAgentLimit(agent, snapshot, nowMs);
        return (
          <Tooltip key={agent}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={limitControlName(agent, detail)}
                  onClick={onOpenUsage}
                />
              }
            >
              <UsageRing remaining={remaining}>
                <AgentGlyph agent={agent} className="size-3" />
              </UsageRing>
            </TooltipTrigger>
            <TooltipContent>
              {USAGE_AGENT_LABEL[agent]} · {detail}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </section>
  );
}
