import { SESSION_AGENT_LABELS, type SessionEntry } from "../../lib/session-history";
import { getDesktopEnvironment } from "../../lib/platform";
import { tildify } from "../../lib/process-info";
import { formatRelativeTime } from "../../lib/workspace-recents";
import { filterSessions } from "../../sessions/session-filters";
import {
  deadProjects,
  refreshSessions,
  sessionEntries,
  sessionsLoading,
  sessionsLoadState,
} from "../../sessions/sessions-store";
import { useEffect } from "preact/hooks";
import { Button } from "../controls/button";
import { LoadError } from "../controls/load-error";
import type { RailItem } from "../rail-view-model";
import { usageAgentOf } from "./dock-usage-model";

export interface DockHistoryProps {
  /** The focused agent's row, or null when none holds the keyboard. */
  readonly item: RailItem | null;
  /** The focused pane's working directory: sessions are matched on it exactly. */
  readonly cwd: string | null;
  /** Resumes a past session: `App`'s `resumeSessionEntry`, the path the legacy History tab uses. */
  onResume(entry: SessionEntry): void;
}

const Note = ({ children }: { children: string }) => (
  <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
);

/**
 * The stacked dock's History section (LAY-6): the past sessions of the focused agent in the folder
 * its pane stands in, newest first, from the same list the legacy History tab reads. Only Claude
 * Code and Codex record sessions. A row resumes that session.
 */
export function DockHistory({ item, cwd, onResume }: DockHistoryProps) {
  // Scan on open, as the legacy tab does: a history list does not move while you look at it.
  useEffect(() => {
    void refreshSessions();
  }, []);
  const agent = item !== null && item.entry.kind === "agent" ? item.entry.agent : null;
  const recorded = agent === null ? null : usageAgentOf(agent);
  if (agent === null) {
    return <Note>Focus an agent to see its history.</Note>;
  }
  if (recorded === null) {
    return <Note>Sessions are recorded for Claude Code and Codex only.</Note>;
  }
  if (cwd === null) {
    return <Note>This pane's folder is not known yet.</Note>;
  }
  const { homeDir } = getDesktopEnvironment();
  const label = SESSION_AGENT_LABELS[recorded];
  const rows = filterSessions(sessionEntries.value, { agent: recorded, project: cwd });
  const gone = deadProjects.value.has(cwd);
  const state = sessionsLoadState.value;
  return (
    <div aria-busy={state.status === "loading"}>
      {sessionsLoading.value ? <Note>Reading this machine's recorded sessions…</Note> : null}
      {state.status === "error" ? (
        <LoadError message={state.message} onRetry={() => void refreshSessions()} />
      ) : null}
      {gone ? <Note>This folder is gone, so its sessions cannot resume.</Note> : null}
      {rows.length === 0 && state.status === "ready" && !gone ? (
        <Note>{`No ${label} sessions in ${homeDir === "" ? cwd : tildify(cwd, homeDir)}.`}</Note>
      ) : null}
      {rows.length > 0 ? (
        <ul className="p-1" aria-label={`Past ${label} sessions`}>
          {rows.map((entry) => {
            const name = entry.title ?? entry.sessionId;
            return (
              <li key={entry.sessionId}>
                <Button
                  variant="ghost"
                  aria-label={`Resume ${name}`}
                  aria-disabled={gone ? "true" : undefined}
                  className="h-8 w-full justify-start gap-2 px-2"
                  onClick={() => {
                    if (!gone) {
                      onResume(entry);
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left font-normal text-foreground">
                    {name}
                  </span>
                  <span className="shrink-0 font-normal tabular-nums text-muted-foreground">
                    {formatRelativeTime(entry.lastActivityMs, Date.now())}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
