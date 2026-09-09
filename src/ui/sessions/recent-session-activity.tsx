import { SESSION_AGENT_LABELS } from "../../lib/session-history";
import { useId } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
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
import { RailStatusMark } from "../agent-rail";
import { findSessionPane, findOpeningPane } from "./live-session-state";
import { WorkspaceSpinner } from "../workspace-spinner";
import type { PaneLaunchReceipt } from "../../terminal/tab-materialize";
import type { RailState } from "../agent-rail-model";

interface RecentSessionActivityProps {
  /** The sidebar selects unread; all retains the reusable history-row surface. */
  readonly filter?: "all" | "unread";
  onResume(entry: RecentSessionEntry): Promise<boolean | void | PaneLaunchReceipt> | void;
  onFocusPane(tabIndex: number, paneId: number): void;
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

/**
 * The three states a row can be LOUD in, and the word each one says.
 *
 * The mark itself is `aria-hidden` decoration (DL-27.3's dot vocabulary), so a
 * state a screen reader would otherwise never hear is spoken here instead —
 * and only when it means something. `done`/`idle` say nothing: a listed
 * session nobody is running and a run already checked are the same silence.
 */
const LOUD_STATE_WORDS: Readonly<Partial<Record<RailState, string>>> = Object.freeze({
  working: "running",
  asked: "needs you",
  failed: "failed",
  // DL-27.3's sixth word (2026-09-03): the pane that ran this session lost
  // its agent. Loud, because a dead process is something to look at.
  ended: "ended",
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
export function RecentSessionActivity({
  onResume,
  onViewAll,
  onFocusPane,
  filter = "all",
}: RecentSessionActivityProps) {
  const opening = useSignal<ReadonlySet<string>>(new Set());
  const errors = useSignal<ReadonlySet<string>>(new Set());
  const destinations = useSignal<
    ReadonlyMap<string, { readonly entry: RecentSessionEntry; readonly receipt: PaneLaunchReceipt }>
  >(new Map());
  useSignalEffect(() => {
    const previous = destinations.value;
    const remaining = [...previous].filter(
      ([, destination]) =>
        !findSessionPane(destination.entry)?.open &&
        destination.receipt.canFocus() &&
        findOpeningPane(destination.entry, destination.receipt.paneId) !== undefined,
    );
    if (remaining.length !== previous.size) destinations.value = new Map(remaining);
  });
  const base = useId();
  const headingId = `recent-session-activity-heading-${base}`;

  if (!sessionsSupported.value) {
    return null;
  }

  const snapshot = recentSessionEntries.value;
  const unreadOnly = filter === "unread";
  const entries = unreadOnly
    ? snapshot.filter((entry) => findSessionPane(entry)?.signal.state === "asked")
    : snapshot;
  const loadState = recentSessionsLoadState.value;
  const hasEntries = entries.length > 0;
  const coldLoading =
    snapshot.length === 0 && (recentSessionsLoading.value || loadState.status === "idle");

  const openEntry = async (entry: RecentSessionEntry) => {
    const key = `${entry.agent}-${entry.sessionId}`;
    if (opening.value.has(key) || recentDeadProjects.value.has(entry.cwd)) return;
    const pane = findSessionPane(entry);
    const receipt = destinations.value.get(key);
    const destination = pane?.open
      ? pane
      : receipt === undefined || !receipt.receipt.canFocus()
        ? undefined
        : findOpeningPane(entry, receipt.receipt.paneId);
    if (destination !== undefined) {
      // Clear the row's error before returning. The clear used to live only on
      // the resume path below, so a row that had failed once and then became
      // focusable kept its `role="alert"` line — "Couldn't open this session"
      // printed under a pane the press had just brought into view.
      errors.value = new Set([...errors.value].filter((value) => value !== key));
      onFocusPane(destination.tabIndex, destination.paneId);
      return;
    }
    // A signal updates synchronously, so a second click before rendering is
    // also locked. "Opening" ends when materialization answers, not when the
    // CLI starts working: that is a separate signal, with its own ring.
    opening.value = new Set([...opening.value, key]);
    errors.value = new Set([...errors.value].filter((value) => value !== key));
    try {
      const result = await onResume(entry);
      if (result === false) {
        errors.value = new Set([...errors.value, key]);
      } else if (result !== undefined && result !== true) {
        destinations.value = new Map([...destinations.value, [key, { entry, receipt: result }]]);
      }
    } catch (error: unknown) {
      console.warn("Could not open recent session:", error);
      errors.value = new Set([...errors.value, key]);
    } finally {
      opening.value = new Set([...opening.value].filter((value) => value !== key));
    }
  };

  return (
    <section
      class="recent-session-activity"
      aria-labelledby={headingId}
      aria-busy={loadState.status === "loading" || coldLoading}
    >
      <header class="recent-session-activity__header">
        <h2 id={headingId} class="recent-session-activity__heading">
          {unreadOnly ? "Unread" : "Recent activity"}
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
        <ul
          class="recent-session-activity__rows"
          aria-label={unreadOnly ? "Unread recent sessions" : "Recent sessions"}
        >
          {entries.map((entry) => {
            const dead = recentDeadProjects.value.has(entry.cwd);
            const name = sessionName(entry);
            const reasonId = dead ? unavailableReasonId(base, entry) : undefined;
            const activityTime = formatActivityTime(entry.lastActivityMs, Date.now());
            const key = `${entry.agent}-${entry.sessionId}`;
            const pane = findSessionPane(entry);
            const live = pane?.signal;
            const receipt = destinations.value.get(key);
            const isOpen =
              pane?.open ||
              (receipt !== undefined &&
                receipt.receipt.canFocus() &&
                findOpeningPane(entry, receipt.receipt.paneId) !== undefined);
            const busy = opening.value.has(key);
            const failed = errors.value.has(key);
            const loudWord = live === undefined ? undefined : LOUD_STATE_WORDS[live.state];
            return (
              <li key={`${entry.agent}-${entry.sessionId}`} class="recent-session-activity__slot">
                <button
                  type="button"
                  class={`recent-session-activity__row${dead ? " is-unavailable" : ""}`}
                  aria-disabled={dead || busy || undefined}
                  aria-busy={busy || undefined}
                  title={`${isOpen ? "Open" : "Resume"} ${name} — ${entry.cwd}`}
                  aria-describedby={reasonId}
                  onClick={() => void openEntry(entry)}
                >
                  <span class="recent-session-activity__resume-prefix">
                    {isOpen ? "Open" : "Resume"} {ACTIVITY_AGENT_LABELS[entry.agent]} — {name}:{" "}
                  </span>
                  <AgentGlyph agent={entry.agent} className="recent-session-activity__glyph" />
                  <span class="recent-session-activity__content">
                    <span class="recent-session-activity__copy">
                      <span class="recent-session-activity__summary">{summary(entry)}</span>
                      {dead ? (
                        <span class="recent-session-activity__gone" aria-hidden="true">
                          gone
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <time class="recent-session-activity__time" dateTime={activityTime.dateTime}>
                    {activityTime.label}
                  </time>
                  <span
                    class="recent-session-activity__state"
                    title={busy ? "Opening session" : loudWord}
                  >
                    {busy ? (
                      <span class="recent-session-activity__opening" aria-hidden="true">
                        <WorkspaceSpinner />
                      </span>
                    ) : live === undefined ? null : (
                      <RailStatusMark state={live.state} confidence={live.confidence} />
                    )}
                  </span>
                  {busy ? (
                    <span class="recent-session-activity__state-word" role="status">
                      Opening…
                    </span>
                  ) : loudWord === undefined ? null : (
                    <span class="recent-session-activity__state-word">{loudWord}. </span>
                  )}
                </button>
                {failed ? (
                  <p class="recent-session-activity__error" role="alert">
                    Couldn't open this session. Try again.
                  </p>
                ) : null}
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

      {!hasEntries && !coldLoading && loadState.status !== "error" ? (
        <p class="recent-session-activity__empty">
          {unreadOnly ? "No unread recent sessions." : "No recent sessions."}
        </p>
      ) : null}
    </section>
  );
}
