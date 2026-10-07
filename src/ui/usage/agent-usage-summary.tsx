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
} from "../../lib/agent-limits";

interface AgentUsageSummaryProps {
  readonly onOpenUsage: () => void;
  readonly snapshot?: AgentLimitsSnapshot;
  readonly nowMs?: number;
}

/** The source reports usage; every displayed percentage is the remaining allowance. */
export function AgentUsageSummary({
  onOpenUsage,
  snapshot = [],
  nowMs = Date.now(),
}: AgentUsageSummaryProps) {
  return (
    <section class="agent-usage-summary" aria-label="Agent limits">
      <ul class="agent-usage-summary__rows" aria-label="Agent limits" tabIndex={0}>
        {USAGE_AGENT_ORDER.map((agent) => {
          const reading = snapshot.find((row) => row.agent === agent);
          const windows = currentLimitWindows(reading, nowMs);
          // One window per agent (DL-33.1, amended 2026-10-07): the one closest to its limit.
          // The tooltip still lists every window.
          const binding = windows.reduce<(typeof windows)[number] | undefined>(
            (tightest, window) =>
              tightest === undefined || window.usedPercent > tightest.usedPercent
                ? window
                : tightest,
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
          return (
            <li key={agent}>
              <button
                type="button"
                class="agent-usage-summary__agent"
                onClick={onOpenUsage}
                aria-label={`${USAGE_AGENT_LABEL[agent]}: ${detail}. Open usage details`}
                title={`${USAGE_AGENT_LABEL[agent]} · ${detail}`}
              >
                <span aria-hidden="true">
                  {USAGE_AGENT_SHORT_LABEL[agent]}{" "}
                  <b class="agent-usage-summary__limit">
                    {binding ? `${Math.floor(100 - binding.usedPercent)}%` : EM_DASH}
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
