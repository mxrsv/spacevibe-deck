/**
 * Which listed session a live pane is running, and what state that pane is in.
 *
 * Recent activity lists sessions, not panes: a row is a conversation on disk,
 * and a conversation on disk has no state of its own. The only honest source
 * for "what is this agent doing right now" is the pane that happens to be
 * running that exact session — so this module joins the two by SESSION ID and
 * nothing else.
 *
 * The id comes from `session-tail-store`'s pairings, which the main process
 * confirmed by answering with the id it actually read. Matching by (agent, cwd)
 * or by mtime proximity instead is precisely the guess that printed one
 * sentence on three rail rows at once (2026-08-22); a row whose session no pane
 * holds simply has no live state, which the caller draws as the quiet dot.
 */
import { computed, type ReadonlySignal } from "@preact/signals";
import { paneSessionIds } from "../../terminal/session-tail-store";
import { NO_PANES, tabViews } from "../../terminal/tabs-store";
import { paneSignal, type RailSignal } from "../agent-rail-model";

const NO_STATES: ReadonlyMap<string, RailSignal> = new Map();

/**
 * Session id → the rail signal of the pane running it — state AND confidence
 * (DL-27.3, amended 2026-09-03) — for every pairing this window holds. Absent
 * means "no pane in this window is in that conversation", never "quiet" — the
 * two are different facts and only the row decides how to draw the second one.
 *
 * `paneSignal` is the rail's own mapping (DL-27.3), imported rather than
 * copied so the sidebar cannot grow a second state vocabulary — and so an
 * inferred `asked` draws hollow on a Recent row exactly as it does on the
 * pane's rail row, rather than the two surfaces disagreeing about one pane.
 */
export const liveSessionStates: ReadonlySignal<ReadonlyMap<string, RailSignal>> = computed(() => {
  const pairings = paneSessionIds.value;
  const tabs = tabViews.value;
  if (pairings.size === 0 || tabs.length === 0) {
    return NO_STATES;
  }
  const states = new Map<string, RailSignal>();
  for (const tab of tabs) {
    for (const pane of tab.panes ?? NO_PANES) {
      const sessionId = pairings.get(pane.paneId);
      if (sessionId === undefined || states.has(sessionId)) {
        continue;
      }
      states.set(sessionId, paneSignal(pane));
    }
  }
  return states;
});
