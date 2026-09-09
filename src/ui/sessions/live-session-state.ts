/** Exact session-to-pane lookup shared by Recent activity rendering and clicks. */
import type { SessionEntry } from "../../lib/session-history";
import { paneSessionIds } from "../../terminal/session-tail-store";
import { NO_PANES, tabViews } from "../../terminal/tabs-store";
import { paneSignal } from "../agent-rail-model";

/**
 * Re-read this at click time: a rendered row may outlive its pane. A contract
 * session id outranks a tail pairing, and an exited agent is never a focus
 * destination. Keep an exited match only to report its state on the row.
 * No matching by directory or transcript time: those do not identify a session.
 */
export function findSessionPane(entry: Pick<SessionEntry, "agent" | "sessionId">) {
  const pairings = paneSessionIds.value;
  const matches = tabViews.value.flatMap((tab, tabIndex) =>
    (tab.panes ?? NO_PANES)
      .filter(
        (pane) =>
          pane.agent === entry.agent &&
          (pane.sessionId ?? pairings.get(pane.paneId)) === entry.sessionId,
      )
      .map((pane) => ({
        tabIndex,
        paneId: pane.paneId,
        open: pane.phase !== "exited",
        signal: paneSignal(pane),
      })),
  );
  return matches.find((match) => match.open) ?? matches[0];
}

/** A receipt identifies our launch destination, not a confirmed conversation. */
export function findOpeningPane(entry: Pick<SessionEntry, "agent" | "sessionId">, paneId: number) {
  const tabs = tabViews.value;
  const tabIndex = tabs.findIndex((tab) => tab.panes?.some((pane) => pane.paneId === paneId));
  const pane = tabs[tabIndex]?.panes?.find((candidate) => candidate.paneId === paneId);
  if (pane === undefined || pane.phase === "exited") return undefined;
  if (pane.agent !== null && pane.agent !== entry.agent) return undefined;
  const sessionId = pane.sessionId ?? paneSessionIds.value.get(paneId);
  if (sessionId !== undefined && sessionId !== null && sessionId !== entry.sessionId)
    return undefined;
  return { tabIndex, paneId };
}
