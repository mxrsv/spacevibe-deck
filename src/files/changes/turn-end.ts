/**
 * "A pane stopped working" as a trigger for the Changes list (CHG3).
 *
 * File watching drops events on every platform, so the end of an agent's turn
 * is the moment worth reading regardless: a pane whose phase leaves `working`
 * for `idle` or `exited`. Prompt-ready is deliberately not used — it marks a
 * CLI exiting to the shell, not a turn ending (spec, Evidence).
 *
 * Panes of other windows are not in this window's `tabViews`; the watch and
 * focus cover them.
 */
import { effect, untracked } from "@preact/signals";
import type { AgentPhase } from "../../terminal/agent-activity";
import { tabViews, type TabView } from "../../terminal/tabs-store";

type Phases = ReadonlyMap<number, AgentPhase>;

/** Workspaces with a pane that left `working` since `previous`, and the new map. */
export function detectTurnEnds(
  previous: Phases,
  views: readonly TabView[],
): { readonly ended: readonly string[]; readonly next: Phases } {
  const next = new Map<number, AgentPhase>();
  const ended = new Set<string>();
  for (const view of views) {
    for (const pane of view.panes ?? []) {
      next.set(pane.paneId, pane.phase);
      const wasWorking = previous.get(pane.paneId) === "working";
      const stopped = pane.phase === "idle" || pane.phase === "exited";
      if (wasWorking && stopped && view.workspacePath !== null) {
        ended.add(view.workspacePath);
      }
    }
  }
  return { ended: [...ended], next };
}

export function installTurnEndWatch(onTurnEnd: (workspacePath: string) => void): () => void {
  let phases: Phases = new Map();
  return effect(() => {
    const result = detectTurnEnds(phases, tabViews.value);
    phases = result.next;
    // Whatever the callback reads must not become this effect's dependency.
    untracked(() => {
      for (const workspacePath of result.ended) {
        onTurnEnd(workspacePath);
      }
    });
  });
}
