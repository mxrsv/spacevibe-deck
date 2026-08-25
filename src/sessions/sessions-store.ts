/**
 * Session history state. Window-scoped module store (R5).
 *
 * Deliberately NOT a poll. The usage screen polls because its numbers move
 * while you look at them; a history list does not — the spec is scan-on-open,
 * re-stat on re-open, and the main-process cache makes the second open cheap.
 * A 5 s poll here would re-read up to 1000 transcript heads for nothing.
 */
import { batch, signal } from "@preact/signals";
import { defaultSessionsClient, type SessionsClient } from "./sessions-client";
import { sessionsHostAvailable } from "../host/sessions-host";
import type { AgentFilter } from "./session-filters";
import type { SessionTailAnswer } from "../lib/agent-resume";
import {
  SESSIONS_DEFAULT_LIMIT,
  type SessionAgent,
  type SessionEntry,
} from "../lib/session-history";
import { LOAD_IDLE, LOAD_LOADING, LOAD_READY, loadError, type LoadState } from "../lib/load-state";

export const RECENT_SESSIONS_LIMIT = 5;

export interface RecentSessionEntry extends SessionEntry {
  readonly summary: string;
}

export const sessionEntries = signal<readonly SessionEntry[]>([]);
export const sessionTotals = signal<Readonly<Record<SessionAgent, number>>>({
  claude: 0,
  codex: 0,
});
export const sessionLimit = signal(SESSIONS_DEFAULT_LIMIT);

/** A cold scan is running and there is nothing yet to show. */
export const sessionsLoading = signal(false);
export const sessionsLoadState = signal<LoadState>(LOAD_IDLE);

export const recentSessionEntries = signal<readonly RecentSessionEntry[]>([]);
/** A cold recent-activity scan is running and there are no last-good rows. */
export const recentSessionsLoading = signal(false);
export const recentSessionsLoadState = signal<LoadState>(LOAD_IDLE);

/**
 * Known synchronously from the Electron bridge, then confirmed by each list.
 * An unsupported host never paints the control for one frame while waiting
 * for the boot effect.
 */
export const sessionsSupported = signal(sessionsHostAvailable());

/** cwds that no longer exist on disk; their rows cannot resume (spec §4). */
export const deadProjects = signal<ReadonlySet<string>>(new Set());
export const recentDeadProjects = signal<ReadonlySet<string>>(new Set());

export const sessionAgentFilter = signal<AgentFilter>("all");
export const sessionProjectFilter = signal<string | null>(null);

/** Probe and refresh freshness are independent; a probe never supersedes data. */
let probeGeneration = 0;
let recentGeneration = 0;
let refreshGeneration = 0;

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
  // Preact runs child effects before parent effects. A restored Sessions dock
  // can therefore start its full refresh before App starts this boot probe.
  // The refresh already proves support and owns the visible state; do not let
  // a limit-1 probe supersede it or strand its loading flag.
  if (sessionsLoadState.value.status === "loading") {
    return;
  }
  probeGeneration += 1;
  const forProbe = probeGeneration;
  const refreshAtStart = refreshGeneration;
  try {
    const supported = (await client.list(1)) !== null;
    if (forProbe === probeGeneration && refreshAtStart === refreshGeneration) {
      sessionsSupported.value = supported;
    }
  } catch {
    if (forProbe === probeGeneration && refreshAtStart === refreshGeneration) {
      sessionsLoadState.value = loadError("Couldn't read recorded sessions.");
    }
  }
}

function recentSummary(entry: SessionEntry, answer: SessionTailAnswer | null | undefined): string {
  if (answer?.id === entry.sessionId && answer.tail !== null && answer.tail.trim() !== "") {
    return answer.tail;
  }
  const title = entry.title?.trim();
  return title === undefined || title === "" ? entry.sessionId : title;
}

interface RecentLoad {
  readonly entries: readonly RecentSessionEntry[];
  readonly deadProjects: ReadonlySet<string>;
}

async function loadRecent(
  client: SessionsClient,
  generation: number,
): Promise<RecentLoad | null | undefined> {
  const snapshot = await client.list(RECENT_SESSIONS_LIMIT);
  if (generation !== recentGeneration) {
    return undefined;
  }
  if (snapshot === null) {
    return null;
  }
  const entries = [...snapshot.entries]
    .sort((left, right) => right.lastActivityMs - left.lastActivityMs)
    .slice(0, RECENT_SESSIONS_LIMIT);
  const projects = [...new Set(entries.map((entry) => entry.cwd))];
  const requests = entries.map((entry) => ({
    agent: entry.agent,
    cwd: entry.cwd,
    lastSeenAt: entry.lastActivityMs,
    preferredId: entry.sessionId,
  }));
  const [tails, alive] = await Promise.all([client.tails(requests), client.dirsExist(projects)]);
  if (generation !== recentGeneration) {
    return undefined;
  }
  return {
    entries: entries.map((entry, index) => ({
      ...entry,
      summary: recentSummary(entry, tails[index]),
    })),
    deadProjects: new Set(projects.filter((_, index) => alive[index] !== true)),
  };
}

export async function refreshRecentSessions(
  client: SessionsClient = defaultSessionsClient,
): Promise<void> {
  recentGeneration += 1;
  const forGeneration = recentGeneration;
  const refreshAtStart = refreshGeneration;
  if (recentSessionEntries.value.length === 0) {
    recentSessionsLoading.value = true;
  }
  recentSessionsLoadState.value = LOAD_LOADING;
  try {
    const recent = await loadRecent(client, forGeneration);
    if (recent === undefined) {
      return;
    }
    if (recent === null) {
      batch(() => {
        if (refreshAtStart === refreshGeneration) {
          sessionsSupported.value = false;
          recentSessionEntries.value = [];
          recentDeadProjects.value = new Set();
        }
        recentSessionsLoadState.value = LOAD_READY;
      });
      return;
    }
    batch(() => {
      if (refreshAtStart === refreshGeneration) {
        sessionsSupported.value = true;
      }
      recentSessionEntries.value = recent.entries;
      recentDeadProjects.value = recent.deadProjects;
      recentSessionsLoadState.value = LOAD_READY;
    });
  } catch (error: unknown) {
    if (forGeneration === recentGeneration) {
      console.warn("recent sessions refresh failed:", error);
      recentSessionsLoadState.value = loadError("Couldn't read recent activity.");
    }
  } finally {
    if (forGeneration === recentGeneration) {
      recentSessionsLoading.value = false;
    }
  }
}

export async function refreshSessions(
  client: SessionsClient = defaultSessionsClient,
): Promise<void> {
  refreshGeneration += 1;
  const forGeneration = refreshGeneration;
  if (sessionEntries.value.length === 0) {
    sessionsLoading.value = true;
  }
  sessionsLoadState.value = LOAD_LOADING;
  try {
    const snapshot = await client.list(SESSIONS_DEFAULT_LIMIT);
    if (forGeneration !== refreshGeneration) {
      return;
    }
    if (snapshot === null) {
      batch(() => {
        sessionsSupported.value = false;
        sessionEntries.value = [];
        sessionsLoadState.value = LOAD_READY;
      });
      return;
    }
    const projects = [...new Set(snapshot.entries.map((entry) => entry.cwd))];
    const alive = await client.dirsExist(projects);
    if (forGeneration !== refreshGeneration) {
      return;
    }
    // Commit one complete snapshot only after both host reads succeed. If the
    // liveness probe fails, publishing new rows with the old dead-project set
    // would be a half-new state masquerading as last-good data.
    batch(() => {
      sessionsSupported.value = true;
      sessionEntries.value = snapshot.entries;
      sessionTotals.value = snapshot.totals;
      sessionLimit.value = snapshot.limit;
      deadProjects.value = new Set(projects.filter((_, index) => alive[index] !== true));
      sessionsLoadState.value = LOAD_READY;
    });
  } catch (error: unknown) {
    // Keep whatever is on screen. Blanking it would turn one failed scan into
    // "you have no sessions", which is a lie — the same rule usage-store
    // states for its own failure path.
    if (forGeneration === refreshGeneration) {
      console.warn("sessions_list failed:", error);
      sessionsLoadState.value = loadError("Couldn't read recorded sessions.");
    }
  } finally {
    if (forGeneration === refreshGeneration) {
      sessionsLoading.value = false;
    }
  }
}
