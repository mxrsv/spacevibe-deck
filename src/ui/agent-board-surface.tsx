/**
 * The Agent Board ON the stage — the twin of `BrowserSurface`
 * (src/browser/browser-surface.tsx) and `StageSurface` (src/files/ui/).
 *
 * Same reasoning as those two: `App` has no render harness in this repo, so
 * the mount condition ("the Board holds the stage") lives in a component of
 * its own to be assertable. And the same geometry: the surface COVERS
 * `.stage__tabs` instead of unmounting it, so the terminal grid keeps its
 * measured size and taking the stage back costs no xterm reflow and no PTY
 * resize round-trip (spec §4.1).
 *
 * The Board-local actions — select and both filters — are bound here, because
 * they move nothing outside the Board's own store. Everything that reaches a
 * pane, a tab or the stage's occupant (`onStop`, `onRestart`, `onClose`,
 * `onOpenInStage`, `onReply`, `onNewAgent`, `onEscape`) is handed in by `App`,
 * which owns the seams.
 */
import { AgentBoard, type AgentBoardActions } from "./agent-board";
import type { AgentBoardView } from "./agent-board-model";
import type { BoardPanelState } from "./agent-board-panel";
import {
  agentBoardSurfaceActive,
  boardProjectFilter,
  boardStatusFilter,
  selectBoardCard,
} from "./agent-board-store";

/**
 * The actions `App` owns — each one touches a pane, a tab, or which surface
 * holds the stage.
 *
 * `onEscape` is in this list rather than bound locally: the store write is
 * Board-local, but stepping off the stage also has to reach
 * `notifySurfacesChanged` and `focusActive`, both of which are App's.
 */
export type BoardHostActions = Pick<
  AgentBoardActions,
  "onOpenInStage" | "onStop" | "onRestart" | "onClose" | "onReply" | "onNewAgent" | "onEscape"
>;

export interface AgentBoardSurfaceProps {
  /**
   * Built by `App` — one `useAgentBoardView()` call, shared with the panel
   * state, so the panel and the grid can never disagree about which card is
   * selected. Never built here.
   */
  readonly view: AgentBoardView;
  readonly actions: BoardHostActions;
  readonly panel: BoardPanelState;
}

export function AgentBoardSurface(props: AgentBoardSurfaceProps) {
  if (!agentBoardSurfaceActive.value) {
    return null; // a terminal tab, a document or the browser holds the stage
  }
  // Safe as an early return because this component calls no hook at all —
  // `view` arrives as a prop for exactly that reason.
  const view = props.view;
  const actions: AgentBoardActions = {
    ...props.actions,
    onSelect: (card) => {
      // The held order is the order the user is LOOKING at (spec §5.2): a live
      // re-sort while a panel is open would move the card under the pointer.
      selectBoardCard(
        card?.paneId ?? null,
        view.cards.map((entry) => entry.paneId),
      );
    },
    onStatusFilter: (filter) => {
      boardStatusFilter.value = filter;
    },
    onProjectFilter: (key) => {
      boardProjectFilter.value = key;
    },
  };
  return (
    <div class="stage__surface stage__surface--agent-board">
      <AgentBoard view={view} actions={actions} panel={props.panel} />
    </div>
  );
}
