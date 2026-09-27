import { reportPersistError } from "../chrome/events";
import { lastSession } from "../terminal/last-session-store";
import {
  clearWindowRecord,
  flushSessionJournal,
  readWindowRecords,
  resumeSessionJournal,
  suspendSessionJournal,
} from "../terminal/session-journal";
import {
  clearSecondaryRecords,
  restoreSession,
  type RestoreDeps,
} from "../terminal/session-restore";
import { countRestoredSessions } from "../telemetry/usage-counters";
import { restoreDeps } from "./app-restore-deps";

/**
 * The Open Board's "reopen last session" click. True when at least one tab
 * came back. The offer is cleared FIRST: the line leaves on the click, a
 * second click cannot start a second restore, and the journal stops holding
 * the record it would otherwise overwrite.
 */
export async function reopenLastSession(deps: {
  readonly manager: RestoreDeps["manager"];
  readonly files: RestoreDeps["files"];
}): Promise<boolean> {
  const held = lastSession.value;
  if (held === null) {
    return false;
  }
  lastSession.value = null;
  suspendSessionJournal();
  try {
    const restored = await restoreSession(
      restoreDeps({ ...deps, records: held.records }),
      held.mainLabel,
    );
    if (restored) {
      // Spec §4: true when a session restore materialized at least one pane.
      countRestoredSessions();
    } else {
      reportPersistError("Couldn't reopen your last session.");
    }
    return restored;
  } catch (err) {
    console.error("session restore failed:", err);
    reportPersistError("Couldn't reopen your last session.");
    return false;
  } finally {
    resumeSessionJournal();
    // The restore's signal changes were ignored while suspended; capture the
    // result now rather than on whatever moves next.
    await flushSessionJournal().catch((err: unknown) => {
      console.warn("Failed to capture the reopened session:", err);
    });
  }
}

/**
 * Decline the offer — the Board's dismiss, or any new tab opening instead.
 * Secondary window records go now, or they would fold into the next launch's
 * offer as ghost tabs; the main record is rewritten by the flush, since the
 * journal no longer holds its empty capture back.
 */
export function discardLastSession(): void {
  const held = lastSession.value;
  if (held === null) {
    return;
  }
  lastSession.value = null;
  void clearSecondaryRecords(
    { readWindowRecords, clearWindowRecord },
    held.records.keys(),
    held.mainLabel,
  )
    .then(() => flushSessionJournal())
    .catch((err: unknown) => {
      console.warn("Failed to discard the last session:", err);
    });
}
