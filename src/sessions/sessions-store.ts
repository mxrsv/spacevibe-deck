/**
 * Session history state. Window-scoped module store (R5).
 *
 * Deliberately NOT a poll. The usage screen polls because its numbers move
 * while you look at them; a history list does not — the spec is scan-on-open,
 * re-stat on re-open, and the main-process cache makes the second open cheap.
 * A 5 s poll here would re-read up to 1000 transcript heads for nothing.
 */
import { signal } from "@preact/signals";
import { defaultSessionsClient, type SessionsClient } from "./sessions-client";
import type { AgentFilter } from "./session-filters";
import {
  SESSIONS_DEFAULT_LIMIT,
  type SessionAgent,
  type SessionEntry,
} from "../lib/session-history";

export const sessionEntries = signal<readonly SessionEntry[]>([]);
export const sessionTotals = signal<Readonly<Record<SessionAgent, number>>>({
  claude: 0,
  codex: 0,
});
export const sessionLimit = signal(SESSIONS_DEFAULT_LIMIT);

/** A cold scan is running and there is nothing yet to show. */
export const sessionsLoading = signal(false);

/**
 * False once the facade has answered `null` — this host has no
 * `sessions_list`. The toolbar control reads it and renders nothing, so the
 * screen is unreachable rather than reachable and empty.
 */
export const sessionsSupported = signal(true);

/** cwds that no longer exist on disk; their rows cannot resume (spec §4). */
export const deadProjects = signal<ReadonlySet<string>>(new Set());

export const sessionAgentFilter = signal<AgentFilter>("all");
export const sessionProjectFilter = signal<string | null>(null);

export function resetSessionFilters(): void {
  sessionAgentFilter.value = "all";
  sessionProjectFilter.value = null;
}

/**
 * Writes `sessionsSupported` and nothing else. Never touches the entries —
 * a limit-1 reply is not a list, and storing it would show one row and call
 * it the history.
 *
 * Runs once at boot rather than at first open, because the spec's promise is
 * that the screen is unreachable on an unsupported host *by construction*: a
 * control that disappears only after it has been clicked once is the opposite
 * of that. It shares no machinery with `refreshSessions` — no generation, no
 * loading flag — so a probe in flight can never blank or supersede a real scan.
 */
export async function probeSessionsSupport(
  client: SessionsClient = defaultSessionsClient,
): Promise<void> {
  try {
    sessionsSupported.value = (await client.list(1)) !== null;
  } catch {
    sessionsSupported.value = false;
  }
}

/** Bumped by every refresh; a reply from a superseded one is dropped. */
let generation = 0;

export async function refreshSessions(
  client: SessionsClient = defaultSessionsClient,
): Promise<void> {
  generation += 1;
  const forGeneration = generation;
  if (sessionEntries.value.length === 0) {
    sessionsLoading.value = true;
  }
  try {
    const snapshot = await client.list(SESSIONS_DEFAULT_LIMIT);
    if (forGeneration !== generation) {
      return;
    }
    if (snapshot === null) {
      sessionsSupported.value = false;
      sessionEntries.value = [];
      return;
    }
    sessionsSupported.value = true;
    sessionEntries.value = snapshot.entries;
    sessionTotals.value = snapshot.totals;
    sessionLimit.value = snapshot.limit;
    const projects = [...new Set(snapshot.entries.map((entry) => entry.cwd))];
    const alive = await client.dirsExist(projects);
    if (forGeneration !== generation) {
      return;
    }
    deadProjects.value = new Set(
      projects.filter((_, index) => alive[index] !== true),
    );
  } catch (error: unknown) {
    // Keep whatever is on screen. Blanking it would turn one failed scan into
    // "you have no sessions", which is a lie — the same rule usage-store
    // states for its own failure path.
    console.warn("sessions_list failed:", error);
  } finally {
    if (forGeneration === generation) {
      sessionsLoading.value = false;
    }
  }
}
