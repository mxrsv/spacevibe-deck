import { getDesktopEnvironment } from "../../lib/platform";
import { tildify } from "../../lib/process-info";
import {
  SESSION_AGENT_LABELS,
  type SessionEntry,
} from "../../lib/session-history";
import {
  cappedAgents,
  distinctProjects,
  filterSessions,
} from "../../sessions/session-filters";
import {
  deadProjects,
  sessionAgentFilter,
  sessionEntries,
  sessionLimit,
  sessionProjectFilter,
  sessionsLoading,
  sessionsLoadState,
  sessionTotals,
  refreshSessions,
} from "../../sessions/sessions-store";
import { SessionRow } from "./session-row";
import { LoadError } from "../controls/load-error";

interface SessionsListProps {
  onResume(entry: SessionEntry): void;
}

/**
 * The section body: a project filter, the row list (DL §25), the cap
 * notice (DL-25.4) and the two states a scan can leave the list in. Reads
 * the store's signals directly rather than taking them as props — the same
 * idiom `overview-section.tsx` uses for `usageSnapshot`, this file owns no
 * state of its own beyond `onResume`, which the click has nowhere else to
 * reach (Task 7/8 wire it to the tab materialize call, out of this task's
 * scope).
 */
export function SessionsList({ onResume }: SessionsListProps) {
  const { homeDir } = getDesktopEnvironment();

  // The project dropdown is scoped to the active agent filter (spec §3.2:
  // "filters compose"), but never to the project filter itself — a select
  // that dropped its own selected option when nothing else changed would be
  // a broken control.
  const agentFiltered = filterSessions(sessionEntries.value, {
    agent: sessionAgentFilter.value,
    project: null,
  });
  const projects = distinctProjects(agentFiltered);
  const rows = filterSessions(sessionEntries.value, {
    agent: sessionAgentFilter.value,
    project: sessionProjectFilter.value,
  });
  const capped = cappedAgents(sessionTotals.value, sessionLimit.value);

  return (
    <div
      class="sessions-list"
      aria-busy={sessionsLoadState.value.status === "loading"}
    >
      {sessionsLoading.value ? (
        // A status line ABOVE the list, not a state that replaces it —
        // mirrors usage-status.tsx: what is already known stays on screen
        // while a re-scan runs, rather than a spinner hiding it.
        <p class="sessions-list__note">
          Reading this machine's recorded sessions…
        </p>
      ) : null}

      {sessionsLoadState.value.status === "error" ? (
        <LoadError
          message={sessionsLoadState.value.message}
          onRetry={() => void refreshSessions()}
        />
      ) : null}

      {projects.length > 0 ? (
        <div class="sessions-list__filter-row">
          <select
            class="sessions-list__project"
            aria-label="Filter by project"
            value={sessionProjectFilter.value ?? ""}
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              sessionProjectFilter.value = value === "" ? null : value;
            }}
          >
            <option value="">All projects</option>
            {projects.map((cwd) => (
              <option key={cwd} value={cwd}>
                {homeDir === "" ? cwd : tildify(cwd, homeDir)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* DL-25.4: a list that shows less than it found says so — silence
          would read as "this is everything" when it is really "the newest
          N", the list equivalent of an empty table vanishing instead of
          saying so. */}
      {capped.length > 0 ? (
        <p class="sessions-list__cap-note">
          {capped
            .map(
              (agent) =>
                `Showing latest ${sessionLimit.value} of ${sessionTotals.value[agent]} for ${SESSION_AGENT_LABELS[agent]}.`,
            )
            .join(" ")}
        </p>
      ) : null}

      {rows.length === 0 && sessionsLoadState.value.status === "ready" ? (
        <p class="sessions-list__empty">
          {sessionEntries.value.length === 0
            ? // Spec §3.2: name where Deck looked, so an empty list reads
              // as "found nothing" rather than "broken".
              "No sessions found in ~/.claude/projects or ~/.codex/sessions."
            : "No sessions match this filter."}
        </p>
      ) : rows.length > 0 ? (
        <ul class="sessions-list__rows" aria-label="Past sessions">
          {rows.map((entry) => (
            <SessionRow
              key={`${entry.agent}-${entry.sessionId}`}
              entry={entry}
              dead={deadProjects.value.has(entry.cwd)}
              homeDir={homeDir}
              onResume={onResume}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
