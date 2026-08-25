import { SESSION_AGENT_LABELS } from "../../lib/session-history";
import { useId } from "preact/hooks";
import {
  recentDeadProjects,
  recentSessionEntries,
  recentSessionsLoading,
  recentSessionsLoadState,
  refreshRecentSessions,
  sessionsSupported,
  type RecentSessionEntry,
} from "../../sessions/sessions-store";
import { AgentGlyph } from "../controls/agent-glyph";
import { LoadError } from "../controls/load-error";

interface RecentSessionActivityProps {
  onResume(entry: RecentSessionEntry): void;
  onViewAll(): void;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

function formatActivityTime(then: number, now: number): string {
  const age = Math.max(0, now - then);
  if (age < MINUTE_MS) {
    return "now";
  }
  if (age < HOUR_MS) {
    return `${Math.floor(age / MINUTE_MS)}m ago`;
  }
  if (age < DAY_MS) {
    return `${Math.floor(age / HOUR_MS)}h ago`;
  }
  if (age < WEEK_MS) {
    return `${Math.floor(age / DAY_MS)}d ago`;
  }
  if (age < MONTH_MS) {
    return `${Math.floor(age / WEEK_MS)}w ago`;
  }
  if (age < YEAR_MS) {
    return `${Math.floor(age / MONTH_MS)}mo ago`;
  }
  return `${Math.floor(age / YEAR_MS)}y ago`;
}

function sessionName(entry: RecentSessionEntry): string {
  return entry.title?.trim() || entry.sessionId;
}

function summary(entry: RecentSessionEntry): string {
  return entry.summary.trim() || sessionName(entry);
}

function unavailableReasonId(base: string, entry: RecentSessionEntry): string {
  return `recent-session-unavailable-${base}-${entry.agent}-${entry.sessionId}`;
}

/**
 * Compact five-session re-entry block for the Agent Rail. The Sessions store
 * owns ordering, the five-item cap, liveness, and last-good refresh state;
 * this component only presents that snapshot and delegates its two outcomes.
 */
export function RecentSessionActivity({ onResume, onViewAll }: RecentSessionActivityProps) {
  const base = useId();
  const headingId = `recent-session-activity-heading-${base}`;

  if (!sessionsSupported.value) {
    return null;
  }

  const entries = recentSessionEntries.value;
  const loadState = recentSessionsLoadState.value;
  const hasEntries = entries.length > 0;
  const coldLoading = !hasEntries && (recentSessionsLoading.value || loadState.status === "idle");

  return (
    <section
      class="recent-session-activity"
      aria-labelledby={headingId}
      aria-busy={loadState.status === "loading" || coldLoading}
    >
      <header class="recent-session-activity__header">
        <h2 id={headingId} class="recent-session-activity__heading">
          Recent activity
        </h2>
        <button type="button" class="recent-session-activity__view-all" onClick={onViewAll}>
          View all
        </button>
      </header>

      {coldLoading ? (
        <p class="recent-session-activity__status" role="status">
          Reading recent activity…
        </p>
      ) : null}

      {loadState.status === "error" ? (
        <LoadError message={loadState.message} onRetry={() => void refreshRecentSessions()} />
      ) : null}

      {hasEntries ? (
        <ul class="recent-session-activity__rows" aria-label="Recent sessions">
          {entries.map((entry) => {
            const dead = recentDeadProjects.value.has(entry.cwd);
            const name = sessionName(entry);
            const reasonId = dead ? unavailableReasonId(base, entry) : undefined;
            return (
              <li key={`${entry.agent}-${entry.sessionId}`} class="recent-session-activity__slot">
                <button
                  type="button"
                  class={`recent-session-activity__row${dead ? " is-unavailable" : ""}`}
                  aria-label={`Resume ${name}`}
                  aria-disabled={dead || undefined}
                  aria-describedby={reasonId}
                  onClick={() => {
                    if (!dead) {
                      onResume(entry);
                    }
                  }}
                >
                  <AgentGlyph agent={entry.agent} className="recent-session-activity__glyph" />
                  <span class="recent-session-activity__content">
                    <span class="recent-session-activity__copy">
                      <span class="recent-session-activity__agent">
                        {SESSION_AGENT_LABELS[entry.agent]}
                      </span>
                      <span class="recent-session-activity__summary">{summary(entry)}</span>
                    </span>
                    {dead ? (
                      <span id={reasonId} class="recent-session-activity__unavailable">
                        folder is gone
                      </span>
                    ) : null}
                  </span>
                  <time
                    class="recent-session-activity__time"
                    dateTime={new Date(entry.lastActivityMs).toISOString()}
                  >
                    {formatActivityTime(entry.lastActivityMs, Date.now())}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!hasEntries && loadState.status === "ready" ? (
        <p class="recent-session-activity__empty">No recent sessions.</p>
      ) : null}
    </section>
  );
}
