/** Exact session-to-pane lookup shared by Recent activity rendering and clicks. */
import type { SessionEntry } from "../../lib/session-history";
import { NO_PANES, tabViews } from "../../terminal/tabs-store";
import { paneSignal } from "../agent-rail-model";

/**
 * Re-read this at click time: a rendered row may outlive its pane. Only a
 * contract session id identifies a conversation. Tail pairings may be ranked
 * by transcript time; using one here could acknowledge a different session.
 * An exited match can describe a row, but is never a focus destination.
 */
export function findSessionPane(entry: Pick<SessionEntry, "agent" | "sessionId">) {
  const matches = tabViews.value.flatMap((tab, tabIndex) =>
    (tab.panes ?? NO_PANES)
      .filter((pane) => pane.agent === entry.agent && pane.sessionId === entry.sessionId)
      .map((pane) => ({
        tabIndex,
        paneId: pane.paneId,
        open: pane.phase !== "exited",
        signal: paneSignal(pane),
      })),
  );
  return matches.find((match) => match.open) ?? matches[0];
}

/**
 * The caller validates the launch receipt. A conflicting contract id can
 * reject that destination; a guessed tail pairing cannot replace its identity.
 */
export function findOpeningPane(entry: Pick<SessionEntry, "agent" | "sessionId">, paneId: number) {
  const tabs = tabViews.value;
  const tabIndex = tabs.findIndex((tab) => tab.panes?.some((pane) => pane.paneId === paneId));
  const pane = tabs[tabIndex]?.panes?.find((candidate) => candidate.paneId === paneId);
  if (pane === undefined || pane.phase === "exited") return undefined;
  if (pane.agent !== null && pane.agent !== entry.agent) return undefined;
  const sessionId = pane.sessionId;
  if (sessionId !== undefined && sessionId !== null && sessionId !== entry.sessionId)
    return undefined;
  return { tabIndex, paneId };
}
