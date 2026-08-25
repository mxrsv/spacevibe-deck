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
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 12 * MONTH_MS;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_COMPACT_YEARS = 99;

const ACTIVITY_AGENT_LABELS = Object.freeze({
  ...SESSION_AGENT_LABELS,
  claude: "Claude",
});

interface ActivityTime {
  readonly label: string;
  readonly dateTime?: string;
}

function formatActivityTime(then: number, now: number): ActivityTime {
  if (!Number.isFinite(then) || Math.abs(then) > MAX_DATE_MS) {
    return { label: "—" };
  }

  const dateTime = new Date(then).toISOString();
  const age = Math.max(0, now - then);
  if (age < MINUTE_MS) {
    return { label: "now", dateTime };
  }
  if (age < HOUR_MS) {
    return { label: `${Math.floor(age / MINUTE_MS)}m`, dateTime };
  }
  if (age < DAY_MS) {
    return { label: `${Math.floor(age / HOUR_MS)}h`, dateTime };
  }
  if (age < MONTH_MS) {
    return { label: `${Math.floor(age / DAY_MS)}d`, dateTime };
  }
  if (age < YEAR_MS) {
    return { label: `${Math.floor(age / MONTH_MS)}mo`, dateTime };
  }
  const years = Math.floor(age / YEAR_MS);
  return {
    label: years > MAX_COMPACT_YEARS ? `${MAX_COMPACT_YEARS}y+` : `${years}y`,
    dateTime,
  };
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
            const activityTime = formatActivityTime(entry.lastActivityMs, Date.now());
            return (
              <li key={`${entry.agent}-${entry.sessionId}`} class="recent-session-activity__slot">
                <button
                  type="button"
                  class={`recent-session-activity__row${dead ? " is-unavailable" : ""}`}
                  aria-disabled={dead || undefined}
                  aria-describedby={reasonId}
                  onClick={() => {
                    if (!dead) {
                      onResume(entry);
                    }
                  }}
                >
                  <span class="recent-session-activity__resume-prefix">Resume {name}: </span>
                  <AgentGlyph agent={entry.agent} className="recent-session-activity__glyph" />
                  <span class="recent-session-activity__content">
                    <span class="recent-session-activity__copy">
                      <span class="recent-session-activity__agent">
                        {ACTIVITY_AGENT_LABELS[entry.agent]}
                      </span>
                      <span class="recent-session-activity__summary">{summary(entry)}</span>
                    </span>
                  </span>
                  {dead ? (
                    <span class="recent-session-activity__gone" aria-hidden="true">
                      gone
                    </span>
                  ) : (
                    <time class="recent-session-activity__time" dateTime={activityTime.dateTime}>
                      {activityTime.label}
                    </time>
                  )}
                </button>
                {dead ? (
                  <span id={reasonId} class="recent-session-activity__unavailable-reason">
                    folder is gone
                  </span>
                ) : null}
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
