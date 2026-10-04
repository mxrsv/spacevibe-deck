import { type AgentTotal } from "../../../lib/usage-aggregate";
import { AGENT_LOGOS } from "../../../lib/agent-logos";
import { dotColor } from "../../../lib/process-info";
import { formatUsd } from "../../../lib/usage-pricing";
import { totalTokens, type UsageBucket } from "../../../lib/usage-snapshot";
import { usageSnapshot, usageLoading, usageStale } from "../../../usage/usage-store";
import { activeUsageRange } from "../active-usage-view-store";
import { UsageRangeSelector } from "../usage-range-selector";
import { USAGE_RANGES, type UsageRangeId } from "../usage-ranges";
import { useMemo } from "preact/hooks";
import { useAgentLimits, type AgentLimitsView } from "../use-agent-limits";
import { RemainingAllowance } from "../remaining-allowance";
import { CostTimeline } from "../cost-timeline";
import { buildUsageTimeline } from "../usage-timeline";
import { EM_DASH, ESTIMATE_NOTE, formatTokensCompact, USAGE_AGENT_LABEL } from "../usage-format";

/** Shares are printed to one decimal, so the arithmetic runs in tenths. */
const PERCENT_TENTHS = 1000;

interface AgentBlock {
  readonly agent: string;
  readonly label: string;
  readonly logo: string | undefined;
  readonly color: string;
  /** The priced part; null only when nothing this agent ran has a price. */
  readonly costUsd: number | null;
  readonly tokens: number;
  /** Tokens the amount excludes, so the row can say what is missing. */
  readonly unpricedTokens: number;
  /** null when there is no stated total to be a share OF (DL-16.5). */
  readonly sharePercent: number | null;
}

/**
 * The priced part of the whole corpus, or `null` when not one model anywhere
 * has a price.
 *
 * This is the 2026-08-10 refinement of §0.3 decision 8. The old rule answered
 * `null` if ANY agent's cost was unknown, and on the real corpus a single
 * unrecognised model id holding 0.2% of Codex's tokens blanked a correct
 * $13,372.98 — it deleted an accurate number in the name of avoiding a
 * misleading one. The figure now covers everything that can be priced and the
 * footnote states the boundary. Neither half is optional: the sum without the
 * disclosure would be exactly the misleading total the old rule feared.
 */
function pricedTotal(totals: readonly AgentTotal[]): number | null {
  let sum = 0;
  let priced = 0;
  for (const total of totals) {
    if (total.costUsd === null) {
      continue;
    }
    sum += total.costUsd;
    priced += 1;
  }
  return priced === 0 ? null : sum;
}

/**
 * Shares in tenths of a percent, by largest remainder, so the printed figures
 * add up to exactly 100.0 — rounding each share independently prints
 * 33.3 + 33.3 + 33.3 = 99.9, and a reader who adds the column up is entitled
 * to get 100. Every share is floored first; the leftover tenths then go to the
 * largest fractional parts, ties broken by position so the result is stable
 * across renders rather than dependent on sort order.
 */
function largestRemainderShares(costs: readonly number[]): readonly number[] {
  const sum = costs.reduce((running, cost) => running + cost, 0);
  if (sum <= 0) {
    return costs.map(() => 0);
  }
  const exact = costs.map((cost) => (cost / sum) * PERCENT_TENTHS);
  const tenths = exact.map(Math.floor);
  const assigned = tenths.reduce((running, part) => running + part, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let spare = 0; spare < PERCENT_TENTHS - assigned; spare += 1) {
    tenths[byRemainder[spare % byRemainder.length].index] += 1;
  }
  return tenths.map((part) => part / 10);
}

/**
 * Cost descending, unpriced agents last, then tokens descending. The tail
 * rules are not decoration: with no cost to rank by, an unpriced agent would
 * otherwise land wherever the upstream sort left it and the block order would
 * change between renders of identical data.
 */
function compareBlocks(left: AgentTotal, right: AgentTotal): number {
  if (left.costUsd === null || right.costUsd === null) {
    if (left.costUsd !== null) {
      return -1;
    }
    if (right.costUsd !== null) {
      return 1;
    }
  } else if (left.costUsd !== right.costUsd) {
    return right.costUsd - left.costUsd;
  }
  const byTokens = totalTokens(right.counters) - totalTokens(left.counters);
  return byTokens !== 0 ? byTokens : left.agent.localeCompare(right.agent);
}

function buildBlocks(totals: readonly AgentTotal[], total: number | null): readonly AgentBlock[] {
  const ordered = [...totals].sort(compareBlocks);
  // A share needs a stated total. Without one there is nothing to be a
  // proportion of, so no bar fills and no percentage is printed (DL-16.5).
  const shares =
    total === null ? null : largestRemainderShares(ordered.map((entry) => entry.costUsd ?? 0));
  return ordered.map((entry, index) => ({
    agent: entry.agent,
    label: USAGE_AGENT_LABEL[entry.agent],
    logo: AGENT_LOGOS[entry.agent],
    // The colour this agent already wears on its pane dot and tab (DL-16.4).
    // `dotColor` is keyed by agent ID despite its doc comment saying "label" —
    // `UsageAgent` carries exactly those ids, so this is the intended call and
    // not a bug to "fix" into `USAGE_AGENT_LABEL[...]`.
    color: dotColor(entry.agent),
    costUsd: entry.costUsd,
    tokens: totalTokens(entry.counters),
    unpricedTokens: entry.unpricedTokens,
    sharePercent: shares === null ? null : shares[index],
  }));
}

/**
 * Four cases, and conflating them is how the screen ends up lying about
 * itself. `unpriced` belongs only to an agent whose OWN cost is entirely
 * unknown — never to one whose dollar amount is sitting on the line directly
 * above. An agent that is priced but has no share (no stated total exists,
 * DL-16.5) simply states its tokens. And an agent that is mostly priced names
 * the slice its amount leaves out, so the number is never quietly partial.
 */
function subLine(block: AgentBlock): string {
  const tokens = `${formatTokensCompact(block.tokens)} tokens`;
  if (block.costUsd === null) {
    return `unpriced · ${tokens}`;
  }
  const omitted =
    block.unpricedTokens > 0 ? ` · ${formatTokensCompact(block.unpricedTokens)} unpriced` : "";
  if (block.sharePercent === null) {
    return `${tokens}${omitted}`;
  }
  return `${block.sharePercent}% of cost · ${tokens}${omitted}`;
}

function AgentRow({ block }: { readonly block: AgentBlock }) {
  return (
    <li class="usage-agent">
      <div class="usage-agent__line">
        {block.logo === undefined ? null : (
          <img class="usage-agent__logo" src={block.logo} alt="" />
        )}
        <span class="usage-agent__label">{block.label}</span>
        <span class="usage-agent__amount">
          {block.costUsd === null ? EM_DASH : formatUsd(block.costUsd)}
        </span>
      </div>
      {/* aria-hidden: the sub-line below already states the share in words, so
          the bar carries no information of its own (DL-16.6). */}
      <div class="usage-agent__bar" aria-hidden="true">
        <div
          class="usage-agent__fill"
          style={{
            width: `${block.sharePercent ?? 0}%`,
            background: block.color,
          }}
        />
      </div>
      <p class="usage-agent__sub">{subLine(block)}</p>
    </li>
  );
}

export interface OverviewContentProps {
  readonly buckets: readonly UsageBucket[];
  readonly range: UsageRangeId;
  readonly onRangeChange: (range: UsageRangeId) => void;
  readonly limits: AgentLimitsView;
  readonly nowMs: number;
  readonly loading?: boolean;
  readonly stale?: boolean;
}

/** Injectable production markup; fixtures never mount the account-reading wrapper. */
export function OverviewContent({
  buckets,
  range,
  onRangeChange,
  limits,
  nowMs,
  loading = false,
  stale = false,
}: OverviewContentProps) {
  const timeline = useMemo(
    () => buildUsageTimeline(buckets, range, nowMs),
    [buckets, range, nowMs],
  );
  const recorded = timeline.agents;
  const total = pricedTotal(recorded);
  const blocks = buildBlocks(recorded, total);
  const unpriced = [...new Set(recorded.flatMap((entry) => entry.unpricedModels))].sort();
  const definition = USAGE_RANGES.find((entry) => entry.id === range)!;
  return (
    <div class="usage-overview">
      <section class="usage-hero" aria-label="Estimated API cost">
        <p class="usage-hero__eyebrow">Estimated API cost</p>
        <p class={`usage-hero__figure ${total === null ? "usage-hero__figure--absent" : ""}`}>
          {total === null ? EM_DASH : formatUsd(total)}
        </p>
        <p class="usage-hero__footnote">API equivalent, not your subscription bill</p>
        {unpriced.length > 0 && (
          <p class="usage-hero__footnote">
            {total === null ? "No priced data" : "Partial estimate"} · excludes {unpriced.length}{" "}
            {unpriced.length === 1 ? "model" : "models"} with no published price
          </p>
        )}
        {blocks.length === 0 ? (
          <p class="usage-hero__empty">{definition.emptyLabel}</p>
        ) : (
          <ul class="usage-hero__agents">
            {blocks.map((block) => (
              <AgentRow key={block.agent} block={block} />
            ))}
          </ul>
        )}
        <details class="usage-overview__details">
          <summary>Pricing details</summary>
          <p>{ESTIMATE_NOTE}</p>
          <p>This machine’s recorded history only; agent CLIs may prune older transcripts.</p>
          {unpriced.length > 0 && (
            <p>No price for {unpriced.join(", ")}. These tokens are excluded from the estimate.</p>
          )}
        </details>
      </section>
      <RemainingAllowance {...limits} />
      <UsageRangeSelector value={range} onChange={onRangeChange} />
      {loading && !buckets.length ? (
        <p class="usage-overview__note" role="status">
          Reading recorded token history…
        </p>
      ) : null}
      {stale ? (
        <p class="usage-overview__note" role="status">
          Cost history is stale — showing the last good read
        </p>
      ) : null}
      <CostTimeline timeline={timeline} />
    </div>
  );
}

export function OverviewSection() {
  const limits = useAgentLimits();
  const range = USAGE_RANGES.find((entry) => entry.id === activeUsageRange.value)?.id ?? "all";
  return (
    <OverviewContent
      buckets={usageSnapshot.value?.buckets ?? []}
      range={range}
      onRangeChange={(next) => {
        activeUsageRange.value = next;
      }}
      limits={limits}
      nowMs={limits.nowMs}
      loading={usageLoading.value}
      stale={usageStale.value}
    />
  );
}
