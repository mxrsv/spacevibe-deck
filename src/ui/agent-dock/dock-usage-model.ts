/**
 * What the dock's Usage section can say, from the usage snapshot as it stands. Pure.
 *
 * The scanner keys usage by agent, model and repository and has no session or pane dimension
 * (`UsageBucket`), and it reads Claude Code and Codex transcripts only (`UsageAgent`). So the
 * figures are the repository's, for the agents a row names: two agents of one kind in a repository
 * share them, and an agent the scanner does not read has none. Anything finer is a scanner change.
 */
import { agentTotals } from "../../lib/usage-aggregate";
import { totalTokens, type UsageAgent, type UsageSnapshot } from "../../lib/usage-snapshot";
import { startOfLocalDay } from "../usage/usage-ranges";

/** The scanner's agent behind a pane's agent, or null for one it does not read. */
export function usageAgentOf(agent: string): UsageAgent | null {
  return agent === "claude" || agent === "codex" ? agent : null;
}

export interface RepoUsageToday {
  readonly tokens: number;
  /** The priced part; null when something was used and none of it has a price. */
  readonly costUsd: number | null;
}

/**
 * Today's tokens and estimated cost in `repo`, by `agents`: null when there is nothing to say,
 * which is no snapshot yet, no agent the scanner reads, or no readable source for them (a
 * missing or unreadable transcript folder is not "zero tokens").
 */
export function repoUsageToday(
  snapshot: UsageSnapshot | null,
  repo: string,
  agents: readonly UsageAgent[],
  nowMs: number,
): RepoUsageToday | null {
  if (snapshot === null) {
    return null;
  }
  const readable = agents.filter(
    (agent) => snapshot.sources.find((source) => source.agent === agent)?.state === "ok",
  );
  if (readable.length === 0) {
    return null;
  }
  const buckets = snapshot.buckets.filter(
    (bucket) => bucket.repo === repo && readable.includes(bucket.agent),
  );
  const totals = agentTotals(buckets, startOfLocalDay(nowMs));
  let tokens = 0;
  let costUsd: number | null = totals.length === 0 ? 0 : null;
  for (const total of totals) {
    tokens += totalTokens(total.counters);
    if (total.costUsd !== null) {
      costUsd = (costUsd ?? 0) + total.costUsd;
    }
  }
  return { tokens, costUsd };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long a pane's agent has been running: `under a minute`, `42m`, `3h 5m`, `2d`. */
export function runningFor(startedAt: number, nowMs: number): string {
  const age = Math.max(0, nowMs - startedAt);
  if (age < MINUTE) {
    return "under a minute";
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h ${Math.floor((age % HOUR) / MINUTE)}m`;
  }
  return `${Math.floor(age / DAY)}d`;
}
