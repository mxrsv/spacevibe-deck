import type { AgentTotal } from "../../../lib/usage-aggregate";
import { agentTotals } from "../../../lib/usage-aggregate";
import { AGENT_LOGOS } from "../../../lib/agent-logos";
import { dotColor } from "../../../lib/process-info";
import { formatUsd } from "../../../lib/usage-pricing";
import { totalTokens } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
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

/**
 * Local midnight for `nowMs`. `new Date(y, m, d)` is DST-correct by
 * construction — on a spring-forward day it still resolves to the first
 * instant of the local day rather than to a clock time that never happened.
 *
 * The comparison it feeds (`bucketStartMs >= startOfLocalDay(now)`) is exact
 * rather than approximate: every real-world UTC offset is a whole number of
 * 15-minute steps, including the :30 and :45 offsets, so local midnight always
 * lands on a bucket boundary. That is the reason `BUCKET_MS` is 15 minutes.
 *
 * It lives here rather than in `src/lib/` because this section owns no path
 * under `src/lib/`; it is exported so its own test can exercise it directly.
 */
export function startOfLocalDay(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Shares are printed to one decimal, so the arithmetic runs in tenths. */
const PERCENT_TENTHS = 1000;

interface AgentBlock {
  readonly agent: string;
  readonly label: string;
  readonly logo: string | undefined;
  readonly color: string;
  readonly costUsd: number | null;
  readonly tokens: number;
  /** null when there is no stated total to be a share OF (DL-16.5). */
  readonly sharePercent: number | null;
}

/**
 * Whole-corpus cost, or `null` if any agent's is unknown. One unpriced model
 * makes the sum unknowable rather than smaller (§0.3 decision 8): a partial
 * total presented as the total is the one number this screen must never show.
 */
function totalCost(totals: readonly AgentTotal[]): number | null {
  let sum = 0;
  for (const total of totals) {
    if (total.costUsd === null) {
      return null;
    }
    sum += total.costUsd;
  }
  return sum;
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
    sharePercent: shares === null ? null : shares[index],
  }));
}

/** `today · $5.00 · 1M tokens`, or an honest sentence when there was none. */
function todayLine(totals: readonly AgentTotal[]): string {
  if (totals.length === 0) {
    return "today · no usage yet";
  }
  const tokens = totals.reduce(
    (running, entry) => running + totalTokens(entry.counters),
    0,
  );
  const cost = totalCost(totals);
  const money = cost === null ? EM_DASH : formatUsd(cost);
  return `today · ${money} · ${formatTokensCompact(tokens)} tokens`;
}

/**
 * Three cases, and conflating the last two is a lie the screen can tell about
 * itself. `unpriced` belongs to an agent whose OWN cost is unknown. An agent
 * that is priced but has no share — because some OTHER agent is unpriced, so
 * there is no stated total (DL-16.5) — must not be labelled unpriced while its
 * dollar amount sits on the line directly above; it simply states its tokens.
 */
function subLine(block: AgentBlock): string {
  const tokens = `${formatTokensCompact(block.tokens)} tokens`;
  if (block.costUsd === null) {
    return `unpriced · ${tokens}`;
  }
  if (block.sharePercent === null) {
    return tokens;
  }
  return `${block.sharePercent}% of cost · ${tokens}`;
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
  const recorded = agentTotals(buckets, null);

  // Nothing measured at all is its own state, not a $0.00 hero: a confident
  // zero claims a measurement that was never made (DL-15.6's reasoning).
  if (recorded.length === 0) {
    return <p class="usage-hero__empty">no data yet</p>;
  }

  const total = totalCost(recorded);
  const blocks = buildBlocks(recorded, total);
  const unpriced = [
    ...new Set(recorded.flatMap((entry) => entry.unpricedModels)),
  ].sort();

  // An unpriced model is exactly the thing that makes the total null, so these
  // two branches are the same branch seen from either end.
  const footnote =
    total === null
      ? `no price for ${unpriced.join(", ")}`
      : "* if billed at full API rate";

  return (
    <div class="usage-hero">
      {/* The single sanctioned uppercase in this app, written as literal
          capitals rather than `text-transform` so the exception is greppable
          (DL-16.2). It licenses uppercase nowhere else. */}
      <p class="usage-hero__eyebrow">RAW TOKEN COST</p>
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
      <p class="usage-hero__footnote">{footnote}</p>
      {/* Today still has to be on the screen (spec §Surface) — as one line
          under the figure, not a second display figure competing with it
          (DL-16.1). */}
      <p class="usage-hero__today">
        {todayLine(agentTotals(buckets, startOfLocalDay(Date.now())))}
      </p>
      <p class="usage-hero__estimate">{ESTIMATE_NOTE}</p>

      <ul class="usage-hero__agents">
        {blocks.map((block) => (
          <AgentRow key={block.agent} block={block} />
        ))}
      </ul>
    </div>
  );
}
