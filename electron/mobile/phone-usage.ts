/**
 * The numbers the desktop's usage tab shows, folded for a phone: tokens and estimated cost for
 * today and the last 7 days, in total and per agent. Costs use the same price table as the tab
 * (`src/lib/usage-pricing.ts`); an unpriced model adds tokens but no dollars, and the summary
 * says how many tokens that left out, so a partial sum is never presented as complete.
 */
import {
  addCounters,
  EMPTY_COUNTERS,
  totalTokens,
  type UsageAgent,
  type UsageCounters,
  type UsageSnapshot,
} from "../../src/lib/usage-snapshot";
import { estimateCostUsd } from "../../src/lib/usage-pricing";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Window {
  tokens: number;
  costUsd: number | null;
  unpricedTokens: number;
}

export interface UsageWindowSummary extends Window {
  readonly byAgent: Readonly<Record<UsageAgent, Window>>;
}

export interface UsageSummaryResult {
  readonly scannedAtMs: number;
  readonly today: UsageWindowSummary;
  readonly last7Days: UsageWindowSummary;
}

function startOfLocalDay(ms: number): number {
  const at = new Date(ms);
  at.setHours(0, 0, 0, 0);
  return at.getTime();
}

function empty(): Window {
  return { tokens: 0, costUsd: null, unpricedTokens: 0 };
}

function addTo(window: Window, model: string, counters: UsageCounters): void {
  const tokens = totalTokens(counters);
  window.tokens += tokens;
  const cost = estimateCostUsd(model, counters);
  if (cost === null) window.unpricedTokens += tokens;
  else window.costUsd = (window.costUsd ?? 0) + cost;
}

function summarize(snapshot: UsageSnapshot, since: number): UsageWindowSummary {
  const total = empty();
  const byAgent: Record<UsageAgent, Window> = { claude: empty(), codex: empty() };
  let counters = EMPTY_COUNTERS;
  for (const bucket of snapshot.buckets) {
    if (bucket.bucketStartMs < since) continue;
    counters = addCounters(counters, bucket.counters);
    addTo(total, bucket.model, bucket.counters);
    addTo(byAgent[bucket.agent], bucket.model, bucket.counters);
  }
  return { ...total, byAgent };
}

export function summarizeUsage(snapshot: UsageSnapshot, now: number): UsageSummaryResult {
  const today = startOfLocalDay(now);
  return {
    scannedAtMs: snapshot.scannedAtMs,
    today: summarize(snapshot, today),
    last7Days: summarize(snapshot, today - 6 * DAY_MS),
  };
}
