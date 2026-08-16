/**
 * Pure derivations over the session list. No signals here on purpose: the
 * store owns state, this file owns the arithmetic, and the arithmetic is what
 * the tests care about.
 */
import {
  SESSION_AGENTS,
  type SessionAgent,
  type SessionEntry,
} from "../lib/session-history";

export type AgentFilter = SessionAgent | "all";

export interface SessionFilterState {
  readonly agent: AgentFilter;
  /** Exact cwd, or null for every project. */
  readonly project: string | null;
}

export function filterSessions(
  entries: readonly SessionEntry[],
  filters: SessionFilterState,
): readonly SessionEntry[] {
  return entries.filter(
    (entry) =>
      (filters.agent === "all" || entry.agent === filters.agent) &&
      (filters.project === null || entry.cwd === filters.project),
  );
}

/** Each cwd once, ordered by the most recent session that used it. */
export function distinctProjects(
  entries: readonly SessionEntry[],
): readonly string[] {
  const newest = new Map<string, number>();
  for (const entry of entries) {
    const seen = newest.get(entry.cwd);
    if (seen === undefined || entry.lastActivityMs > seen) {
      newest.set(entry.cwd, entry.lastActivityMs);
    }
  }
  return [...newest.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([cwd]) => cwd);
}

/** Agents that had more transcripts than the enrichment cap read — the ones
 *  the "showing latest N" notice must name (spec §3.2). */
export function cappedAgents(
  totals: Readonly<Record<string, number>>,
  limit: number,
): readonly SessionAgent[] {
  return SESSION_AGENTS.filter((agent) => (totals[agent] ?? 0) > limit);
}
