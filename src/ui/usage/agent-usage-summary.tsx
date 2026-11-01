import { createContext, h, type ComponentType } from "preact";
import { useContext } from "preact/hooks";
import {
  EM_DASH,
  USAGE_AGENT_LABEL,
  USAGE_AGENT_ORDER,
  USAGE_AGENT_SHORT_LABEL,
} from "./usage-format";
import { useAgentLimits } from "./use-agent-limits";
import {
  currentLimitWindows,
  limitWindowLabel,
  type AgentLimitsSnapshot,
  type LimitWindow,
} from "../../lib/agent-limits";
import type { UsageAgent } from "../../lib/usage-snapshot";

export interface AgentLimitReading {
  /** The window closest to its limit (DL-33.1): the one the rail shows. */
  readonly binding: LimitWindow | undefined;
  /** Percent left in `binding`, or `null` without a current reading. */
  readonly remaining: number | null;
  /** Every window, or the reason there is none. */
  readonly detail: string;
}

/** The source reports usage; every displayed percentage is the remaining allowance. */
export function readAgentLimit(
  agent: UsageAgent,
  snapshot: AgentLimitsSnapshot,
  nowMs: number,
): AgentLimitReading {
  const reading = snapshot.find((row) => row.agent === agent);
  const windows = currentLimitWindows(reading, nowMs);
  // One window per agent (DL-33.1, amended 2026-10-07): the one closest to its limit.
  // The tooltip still lists every window.
  const binding = windows.reduce<(typeof windows)[number] | undefined>(
    (tightest, window) =>
      tightest === undefined || window.usedPercent > tightest.usedPercent ? window : tightest,
    undefined,
  );
  const unavailable =
    reading?.state === "error"
      ? "Could not refresh limits"
      : reading?.windows.length
        ? "Limit data expired"
        : "Limit unavailable";
  const detail = windows.length
    ? windows
        .map(
          (window) =>
            `${limitWindowLabel(window.durationMinutes)}: ${Math.floor(100 - window.usedPercent)}% remaining; resets ${new Date(window.resetsAtMs).toLocaleString()}`,
        )
        .join(" · ")
    : unavailable;
  return {
    binding,
    remaining: binding ? Math.floor(100 - binding.usedPercent) : null,
    detail,
  };
}

/** The Usage page opens from this control; the name carries the exact figures. */
export function limitControlName(agent: UsageAgent, detail: string): string {
  return `${USAGE_AGENT_LABEL[agent]}: ${detail}. Open usage details`;
}

export interface AgentUsageSummaryProps {
  readonly onOpenUsage: () => void;
  readonly snapshot?: AgentLimitsSnapshot;
  readonly nowMs?: number;
}

/**
 * A surface that draws the summary its own way (the project rail's foot draws one ring per
 * agent) provides the view here; the shipped rail provides none and keeps its text line.
 */
export const AgentUsageViewContext = createContext<ComponentType<AgentUsageSummaryProps> | null>(
  null,
);

/** One micro line of text per agent; rings instead inside the project rail's foot. */
export function AgentUsageSummary(props: AgentUsageSummaryProps) {
  const { onOpenUsage, snapshot = [], nowMs = Date.now() } = props;
  const view = useContext(AgentUsageViewContext);
  if (view !== null) {
    return h(view, props);
  }
  return (
    <section class="agent-usage-summary" aria-label="Agent limits">
      <ul class="agent-usage-summary__rows" aria-label="Agent limits" tabIndex={0}>
        {USAGE_AGENT_ORDER.map((agent) => {
          const { binding, remaining, detail } = readAgentLimit(agent, snapshot, nowMs);
          return (
            <li key={agent}>
              <button
                type="button"
                class="agent-usage-summary__agent"
                onClick={onOpenUsage}
                aria-label={limitControlName(agent, detail)}
                title={`${USAGE_AGENT_LABEL[agent]} · ${detail}`}
              >
                <span aria-hidden="true">
                  {USAGE_AGENT_SHORT_LABEL[agent]}{" "}
                  <b class="agent-usage-summary__limit">
                    {remaining === null ? EM_DASH : `${remaining}%`}
                  </b>
                  {binding ? ` · ${limitWindowLabel(binding.durationMinutes)}` : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Expire a reading at its boundary even when the network is idle or unavailable. */
export function RailAgentLimits({ onOpenUsage }: Pick<AgentUsageSummaryProps, "onOpenUsage">) {
  const { snapshot, nowMs } = useAgentLimits();
  return (
    <AgentUsageSummary
      snapshot={snapshot}
      nowMs={Math.max(nowMs, Date.now())}
      onOpenUsage={onOpenUsage}
    />
  );
}
