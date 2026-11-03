import { reportPersistError } from "../chrome/events";
import { lastSession, summarizeLastSession } from "../terminal/last-session-store";
import {
  flushSessionJournal,
  retainPendingSessionRestore,
  resumeSessionJournal,
  trySuspendSessionJournal,
} from "../terminal/session-journal";
import { restoreSession, type RestoreDeps } from "../terminal/session-restore";
import { countRestoredSessions } from "../telemetry/usage-counters";
import { restoreDeps } from "./app-restore-deps";

/**
 * True only when the reopen completed without pending tabs. Hide the offer
 * during the attempt to prevent double clicks, then offer only failed tabs.
 */
export async function reopenLastSession(deps: {
  readonly manager: RestoreDeps["manager"];
  readonly files: RestoreDeps["files"];
}): Promise<boolean> {
  const held = lastSession.value;
  if (held === null) {
    return false;
  }
  if (!trySuspendSessionJournal()) {
    reportPersistError(
      "Couldn't reopen while Deck is saving your session. Try again after it finishes.",
    );
    return false;
  }
  lastSession.value = null;
  let remaining = held.records;
  let restored = false;
  let saved = false;
  try {
    restored = await restoreSession(
      {
        ...restoreDeps({ ...deps, records: held.records }),
        onProgress: (records) => {
          remaining = records;
        },
      },
      held.mainLabel,
    );
    if (restored) countRestoredSessions();
  } catch (err) {
    console.error("session restore failed:", err);
  } finally {
    const pending = retainPendingSessionRestore(remaining, held.records.keys());
    const retry = summarizeLastSession(pending, held.mainLabel);
    lastSession.value = retry === null ? null : { ...retry, retry: true };
    resumeSessionJournal();
    try {
      await flushSessionJournal({ strict: true });
      saved = true;
    } catch (err) {
      console.warn("Failed to capture the reopened session:", err);
    }
  }
  if (remaining.size > 0) {
    reportPersistError(
      restored
        ? "Some tabs couldn't reopen. Reopen Last session to retry the remaining tabs."
        : "Couldn't reopen your last session. You can retry it.",
    );
  } else if (!restored || !saved) {
    reportPersistError("Couldn't save or reopen your last session.");
  }
  return restored && remaining.size === 0 && saved;
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
  retainPendingSessionRestore(new Map(), held.records.keys());
  void flushSessionJournal({ strict: true }).catch((err: unknown) => {
    console.warn("Failed to discard the last session:", err);
    reportPersistError("Couldn't save your session choice.");
  });
}
