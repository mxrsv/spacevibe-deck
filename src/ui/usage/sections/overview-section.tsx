import type { AgentTotal } from "../../../lib/usage-aggregate";
import { agentTotals } from "../../../lib/usage-aggregate";
import { AGENT_LOGOS } from "../../../lib/agent-logos";
import { dotColor } from "../../../lib/process-info";
import { formatUsd } from "../../../lib/usage-pricing";
import { totalTokens } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { activeUsageRange } from "../active-usage-view-store";
import { UsageRangeSelector } from "../usage-range-selector";
import { rangeSinceMs, USAGE_RANGES } from "../usage-ranges";
import {
  EM_DASH,
  ESTIMATE_NOTE,
  formatTokensCompact,
  USAGE_AGENT_LABEL,
} from "../usage-format";

/**
 * The overview: one display figure saying what this machine's recorded agent
 * history would cost at list prices, then the accounting that adds up to it
 * (DL §16).
 *
 * It was a five-column table until 2026-08-10. The table answered "what are
 * the numbers"; the screen's actual question is "what is this costing me",
 * and that is one number with a breakdown, not a grid to be read across.
 *
 * "Recorded history" rather than "all-time" is not a stylistic choice — the
 * CLIs prune their own transcripts, so the figure is a floor, not a total, and
 * the copy must not promise otherwise (spec §Goal).
 */

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
    .sort(
      (left, right) =>
        right.fraction - left.fraction || left.index - right.index,
    );
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

function buildBlocks(
  totals: readonly AgentTotal[],
  total: number | null,
): readonly AgentBlock[] {
  const ordered = [...totals].sort(compareBlocks);
  // A share needs a stated total. Without one there is nothing to be a
  // proportion of, so no bar fills and no percentage is printed (DL-16.5).
  const shares =
    total === null
      ? null
      : largestRemainderShares(ordered.map((entry) => entry.costUsd ?? 0));
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
    block.unpricedTokens > 0
      ? ` · ${formatTokensCompact(block.unpricedTokens)} unpriced`
      : "";
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

export function OverviewSection() {
  const buckets = usageSnapshot.value?.buckets ?? [];

  // Nothing anywhere is its own state, not a $0.00 hero: a confident zero
  // claims a measurement that was never made (DL-15.6's reasoning). No range
  // selector either — there is nothing to scope, so the control would be a
  // set of four buttons that all say the same thing.
  if (agentTotals(buckets, null).length === 0) {
    return <p class="usage-hero__empty">No data yet</p>;
  }

  // Unknown id can only come from a stale signal; fall back to the whole
  // history rather than rendering a figure scoped to nothing in particular.
  const range =
    USAGE_RANGES.find((entry) => entry.id === activeUsageRange.value) ??
    USAGE_RANGES[USAGE_RANGES.length - 1];
  const recorded = agentTotals(buckets, rangeSinceMs(range, Date.now()));

  const total = pricedTotal(recorded);
  const blocks = buildBlocks(recorded, total);
  // Scoped to the range on purpose: a model that went unpriced last month has
  // nothing to do with a figure covering this week, and naming it there would
  // be a disclosure about data the reader is not being shown.
  const unpriced = [
    ...new Set(recorded.flatMap((entry) => entry.unpricedModels)),
  ].sort();

  // Four footnotes for four honest situations. An EMPTY range has no models
  // at all, so it gets none: `no price for ` with nothing after it was a real
  // bug, and an asterisk explaining a dash is noise the empty line below
  // already covers. With nothing priced the models are named outright. With a
  // figure and a gap, the asterisk's "this is an estimate" is extended to say
  // where the estimate stops — a partial sum is only acceptable while it
  // admits it.
  let footnote: string | null = "* if billed at full API rate";
  if (blocks.length === 0) {
    footnote = null;
  } else if (total === null) {
    footnote = `no price for ${unpriced.join(", ")}`;
  } else if (unpriced.length > 0) {
    const plural = unpriced.length === 1 ? "model" : "models";
    footnote += ` · excludes ${unpriced.length} ${plural} with no published price`;
  }

  return (
    <div class="usage-hero">
      {/* Sentence-case microcopy in --text-muted, no text-transform, no
          tracking (DL-4.3, DL-16.2). */}
      <p class="usage-hero__eyebrow">Raw token cost</p>
      {/* The absent figure is faint, per DL-15.6's "em dash in --text-faint".
          At 40px in --text-primary a bare dash stops reading as "unknown" and
          starts reading as a rule across the page or a loading skeleton; the
          faint step is what keeps it legible as an absence. Same size either
          way, so the block below does not jump when a price lands. */}
      <p
        class={`usage-hero__figure ${
          total === null ? "usage-hero__figure--absent" : ""
        }`}
      >
        {total === null ? EM_DASH : `${formatUsd(total)}*`}
      </p>
      {footnote === null ? null : (
        <p class="usage-hero__footnote">{footnote}</p>
      )}
      {/* The period the figure covers (DL-16.7). This REPLACED a standalone
          `today · $X · N tokens` line on 2026-08-10 — do not restore it as a
          "fix". The spec's "today and recorded history" is still satisfied,
          one click apart, and two totals printed at once contradict each
          other the moment they differ. */}
      <UsageRangeSelector />
      <p class="usage-hero__estimate">{ESTIMATE_NOTE}</p>

      {blocks.length === 0 ? (
        // The range is empty, but the corpus is not. Say WHICH period is
        // empty (DL-16.7) and keep the selector above reachable, or the
        // reader is stranded on a screen that looks broken.
        <p class="usage-hero__empty">{range.emptyLabel}</p>
      ) : (
        <ul class="usage-hero__agents">
          {blocks.map((block) => (
            <AgentRow key={block.agent} block={block} />
          ))}
        </ul>
      )}
    </div>
  );
}
