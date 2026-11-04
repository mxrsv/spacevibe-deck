import { displayText } from "@protocol/display-text";

/** The desktop's usage numbers for one window (`phone-usage.ts`); the phone only formats them. */
export interface UsageWindow {
  readonly tokens: number;
  readonly costUsd: number | null;
  readonly unpricedTokens: number;
}
export interface UsageRange extends UsageWindow {
  readonly byAgent: readonly { readonly agent: string; readonly window: UsageWindow }[];
}
export interface UsageView {
  readonly scannedAtMs: number | null;
  readonly today: UsageRange;
  readonly last7Days: UsageRange;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseWindow(value: unknown): UsageWindow | null {
  const w = record(value);
  if (w === null) return null;
  const tokens = count(w.tokens);
  const unpriced = count(w.unpricedTokens);
  const cost = w.costUsd === null ? null : count(w.costUsd);
  if (tokens === null || unpriced === null || (w.costUsd !== null && cost === null)) return null;
  return { tokens, costUsd: cost, unpricedTokens: unpriced };
}

function range(value: unknown): UsageRange | null {
  const base = parseWindow(value);
  const r = record(value);
  const agents = r === null ? null : record(r.byAgent);
  if (base === null || agents === null) return null;
  const byAgent: { agent: string; window: UsageWindow }[] = [];
  for (const [agent, raw] of Object.entries(agents)) {
    const w = parseWindow(raw);
    if (w === null) return null;
    byAgent.push({ agent: displayText(agent, 32), window: w });
  }
  return { ...base, byAgent };
}

/** The `usage` of a `usage.get` answer, or null when it is not the shape the desktop sends. */
export function parseUsage(value: unknown): UsageView | null {
  const u = record(value);
  if (u === null) return null;
  const today = range(u.today);
  const last7Days = range(u.last7Days);
  if (today === null || last7Days === null) return null;
  return { scannedAtMs: count(u.scannedAtMs), today, last7Days };
}

const TIERS = [
  { at: 1e12, suffix: "T" },
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/** `48.1B`, `16.8M`, `912K`, `999`: the desktop usage tab's compact token count. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  for (const [index, tier] of TIERS.entries()) {
    if (value < tier.at) continue;
    const rounded = Number((value / tier.at).toFixed(1));
    if (rounded >= 1000 && index > 0) {
      const above = TIERS[index - 1];
      return `${Number((value / above.at).toFixed(1))}${above.suffix}`;
    }
    return `${rounded}${tier.suffix}`;
  }
  return String(Math.round(value));
}

const CENTS = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const FRACTIONS = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/** Dollars as the desktop tab shows them; null (no price known at all) is an em dash, never $0. */
export function formatCost(usd: number | null): string {
  if (usd === null) return "—";
  if (!Number.isFinite(usd) || usd <= 0) return `$${CENTS.format(0)}`;
  if (usd < 0.0001) return `< $${FRACTIONS.format(0.0001)}`;
  return `$${(usd < 0.01 ? FRACTIONS : CENTS).format(usd)}`;
}

/**
 * The line that keeps a partial sum from reading as complete: how many tokens had no price and so
 * are in the token count but not in the dollars. Null when everything was priced.
 */
export function unpricedNote(usage: UsageWindow): string | null {
  if (usage.unpricedTokens <= 0) return null;
  return usage.costUsd === null
    ? `Unpriced · ${formatTokens(usage.unpricedTokens)} tokens have no known price, so there is no cost`
    : `${formatTokens(usage.unpricedTokens)} tokens have no known price and are not in this cost`;
}

const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
export function agentLabel(agent: string): string {
  return AGENT_LABEL[agent] ?? agent;
}
