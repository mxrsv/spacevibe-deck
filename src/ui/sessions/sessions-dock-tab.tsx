import { useEffect } from "preact/hooks";
import { refreshSessions } from "../../sessions/sessions-store";
import { SessionsBody } from "./sessions-body";
import type { SessionEntry } from "../../lib/session-history";

interface SessionsDockTabProps {
  onResume(entry: SessionEntry): void;
}

/**
 * Session history as a tab of the docked side panel (DL-19.7).
 *
 * `SessionsBody` is lifecycle-free — it renders whatever the store holds — so
 * whoever shows it owns the scan. Before this component existed the only
 * caller of `refreshSessions` was the Open board's effect, so opening the tab
 * directly (rail row, `toggle-dock`, or a profile that stored
 * `dockTab: "sessions"`) painted the store's initial empty state and claimed
 * there were no sessions.
 *
 * A component rather than an effect inside `App` for the reason
 * `usage-dock-tab.tsx` gives: the lifecycle is tied to the tab being MOUNTED,
 * not to a settings write. `App` renders the three tabs as a ternary, so
 * switching away and back remounts — which is exactly the spec's
 * scan-on-open / re-stat-on-re-open. Unlike usage this starts no poll: a
 * history list does not move while you look at it.
 */
export function SessionsDockTab({ onResume }: SessionsDockTabProps) {
  useEffect(() => {
    void refreshSessions();
  }, []);

  return <SessionsBody variant="dock" onResume={onResume} />;
}
