/**
 * Display strings for the usage screen: what an agent is called, how a token
 * count is grouped, and the disclaimer every dollar figure carries.
 *
 * Pure — no signals, no Tauri, no DOM. It lives under `src/ui/usage/` rather
 * than `src/lib/` on purpose: everything in here is a wording choice this
 * screen makes, while the numeric side (aggregation, pricing) is already pure
 * and already lives in `src/lib/`. Keeping the two apart means a copy change
 * never touches a module with arithmetic in it.
 */

import type { UsageAgent } from "../../lib/usage-snapshot";
import { formatUsd } from "../../lib/usage-pricing";
import { PRICING_SNAPSHOT_DATE } from "../../lib/usage-pricing-snapshot";

/**
 * What a cell shows when a value is unknown, unavailable or not applicable
 * (DL-15.6). Not `0` — zero is a measurement, the dash is the absence of one.
 */
export const EM_DASH = "—";

/**
 * Fixed grouping locale. The chrome is English-only (R1), and pinning the
 * locale keeps a rendered count identical on every machine and in CI instead
 * of following whatever the host is set to.
 */
const TOKEN_LOCALE = "en-US";

/**
 * The agents the scanner covers, in the order every table lists them —
 * the same order `sources` arrives in from Rust (§0.2.2: Claude then Codex),
 * so the screen never disagrees with the payload about which came first.
 */
export const USAGE_AGENT_ORDER: readonly UsageAgent[] = ["claude", "codex"];

/**
 * Display names. Exhaustive over `UsageAgent` by type, so teaching the scanner
 * a third agent fails the typecheck here rather than rendering a raw id. The
 * words match `BUILTIN_AGENTS` in `lib/agent-catalog.ts` — the same tool must
 * not carry two names in one app.
 */
export const USAGE_AGENT_LABEL: Readonly<Record<UsageAgent, string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

/**
 * The sentence every dollar figure carries (spec §Decisions 1): the number is
 * an estimate at API prices, and it was priced from a snapshot taken on a
 * known date. One constant, so three tables cannot drift into three
 * disclaimers.
 */
export const ESTIMATE_NOTE = `estimated at API prices · pricing snapshot ${PRICING_SNAPSHOT_DATE}`;

/** A token count with thousands separators — `1,204,338`. */
export function formatTokens(value: number): string {
  return value.toLocaleString(TOKEN_LOCALE);
}

/**
 * A money cell's content, or `null` when the row has no price. Returning
 * `null` rather than a dash keeps DL-15.6 in exactly one place — the table —
 * so a future caller cannot invent a second placeholder.
 */
export function usdCell(costUsd: number | null): string | null {
  return costUsd === null ? null : formatUsd(costUsd);
}
