/**
 * Turning raw token counters into an estimated dollar figure, and rendering
 * that figure. Pure — no signals, no Tauri, no DOM.
 *
 * The numbers come from `usage-pricing-snapshot.ts`, which is generated and
 * rewritten wholesale by `npm run refresh:pricing`. Nothing in this file is
 * generated: that split is the whole point of having two modules (plan §0.3
 * decision 1) — a script that overwrites a file must never be pointed at one
 * containing logic.
 *
 * Every figure is an ESTIMATE at published list prices. A subscription user
 * does not pay per token, so the surface must always show the estimate label
 * and `PRICING_SNAPSHOT_DATE` beside the number (spec §Decisions 1).
 */

import { PRICING_SNAPSHOT, type ModelPricing } from './usage-pricing-snapshot';
import { totalTokens, type UsageCounters } from './usage-snapshot';

/**
 * Anthropic's published premium for a 1-hour cache write: twice the base
 * input rate (spec §Pricing, ccusage's rule). Verified against LiteLLM on
 * 2026-08-10 — for every Claude model this machine has run,
 * `cache_creation_input_token_cost_above_1hr` is exactly
 * `input_cost_per_token * 2`. The rate is not a field on `ModelPricing`
 * because that shape is frozen at four fields (plan §0.2.5).
 */
const CACHE_1H_INPUT_MULTIPLIER = 2;

/** Below a cent, two decimals round to `$0.00` and tell the user nothing. */
const CENT = 0.01;

/** Below this even four decimals round to zero, so the UI says "less than". */
const MIN_SHOWN_USD = 0.0001;

/**
 * Explicit locale, not the host's: the format must be identical on every
 * machine and in every test run, and `en-US` is what the rest of the UI's
 * English copy assumes.
 */
const USD_LOCALE = 'en-US';
const USD_CENTS = new Intl.NumberFormat(USD_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const USD_FRACTIONS = new Intl.NumberFormat(USD_LOCALE, {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const ZERO_USD = `$${USD_CENTS.format(0)}`;
const BELOW_MIN_USD = `< $${USD_FRACTIONS.format(MIN_SHOWN_USD)}`;

/**
 * Whether the snapshot prices this exact model id. Exact match only in v1
 * (spec §Pricing, alias policy) — the raw string stays visible in the
 * breakdown so a missing mapping is diagnosable rather than invisible.
 *
 * `hasOwnProperty` and not plain indexing: `PRICING_SNAPSHOT` is an object
 * literal, so `PRICING_SNAPSHOT["toString"]` would answer with a function.
 * Same guard as `AGENT_DOT_VARS` in `process-info.ts`.
 */
export function isPricedModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRICING_SNAPSHOT, model);
}

function pricingFor(model: string): ModelPricing | null {
  return isPricedModel(model) ? PRICING_SNAPSHOT[model] : null;
}

/**
 * Estimated USD for one model's counters, or `null` when the model is not in
 * the snapshot. Never a guess: an unpriced model propagates `null` all the
 * way to the row (§0.3 decision 8) and the UI shows an em dash.
 *
 * The zero short-circuit comes first and applies to unknown models too, which
 * is arithmetic rather than pricing: no tokens cost no dollars. It is what
 * keeps Claude Code's `<synthetic>` marker — 138 lines on this machine, every
 * one of them all-zero — from turning the entire Claude dollar column into a
 * permanent em dash.
 */
export function estimateCostUsd(model: string, counters: UsageCounters): number | null {
  if (totalTokens(counters) === 0) {
    return 0;
  }
  const pricing = pricingFor(model);
  if (pricing === null) {
    return null;
  }
  // A provider that publishes no cache rate charges cache traffic as ordinary
  // input; falling back to the input rate is the documented rule for the
  // OpenAI cache-write case and the only non-inventing option for the rest.
  const cacheRead = pricing.cacheReadPerToken ?? pricing.inputPerToken;
  const cacheWrite = pricing.cacheWritePerToken ?? pricing.inputPerToken;
  return (
    counters.inputUncached * pricing.inputPerToken +
    counters.cacheRead * cacheRead +
    counters.cacheCreate5m * cacheWrite +
    counters.cacheCreate1h * pricing.inputPerToken * CACHE_1H_INPUT_MULTIPLIER +
    counters.cacheWrite * cacheWrite +
    counters.output * pricing.outputPerToken
  );
}

/**
 * The house dollar format. Two decimals from a cent upwards, four below it so
 * a genuinely cheap day is not flattened to `$0.00`, and an explicit
 * "less than" once even four decimals would round to zero.
 *
 * A `costUsd` of `null` is NOT this function's job — the caller renders an em
 * dash for that. Non-finite input is treated as zero rather than shown,
 * because `$NaN` on screen is worse than a wrong zero and unreachable anyway:
 * counters are integers and every rate in the snapshot is finite.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return ZERO_USD;
  }
  if (value < MIN_SHOWN_USD) {
    return BELOW_MIN_USD;
  }
  const format = value < CENT ? USD_FRACTIONS : USD_CENTS;
  return `$${format.format(value)}`;
}
