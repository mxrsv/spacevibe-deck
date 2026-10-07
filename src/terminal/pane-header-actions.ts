/**
 * What the agent pane header's buttons call (DL-32.8).
 *
 * The header is a Preact tree `mountPaneAgentHeader` renders into the pane's own
 * bar, outside `App`'s tree, so it cannot receive `App`'s callbacks as props. The
 * seam is this module-level registry — the shape `paneTails` and `chrome/events`
 * already use: `App` registers handlers once it can answer, and the header calls
 * whatever is current with **its own pane's id**. Every handler runs through an
 * existing `App` entry point (`focusRailPane`, `closePaneAt`, the active-pane
 * split), so no PTY, layout, tab-materialization or close-coordination module
 * changes for this (AGENTS.md R4, spec decision 9).
 *
 * The default does nothing, so a header renders in a test or the gallery with no
 * `App` behind it. Window-scoped like every module store (R5).
 */

export type PaneHeaderSplit = "row" | "column";

export interface PaneHeaderActionHandlers {
  /** Split the pane whose header was pressed, not whichever pane is focused. */
  split(paneId: number, direction: PaneHeaderSplit): void;
  /** Flip Focus expand, with that pane focused first so it is the one that grows. */
  toggleExpand(paneId: number): void;
  /** Close that pane, with the rail's own close contract (`closePaneAt`). */
  close(paneId: number): void;
}

/** What `App` can already do, named for the three acts a header needs. */
export interface PaneHeaderActionDeps {
  /** The tab holding the pane, or -1 when no tab does. */
  tabIndexOf(paneId: number): number;
  /** The rail's pane-exact focus (`focusRailPane`): activates the tab, focuses the pane. */
  focusPane(tabIndex: number, paneId: number): void;
  activePaneId(): number | null;
  splitActive(direction: PaneHeaderSplit): void;
  toggleFocusExpand(): void;
  /** `closePaneAt`: the rail ✕'s close model, pane-exact. */
  closePaneAt(tabIndex: number, paneId: number): void;
}

/**
 * The handlers `App` registers. A split and Focus expand act on the ACTIVE pane,
 * so each focuses the pressed pane first and goes on only if it really took the
 * focus: the attention preflight refuses while a preset draft is open, and
 * splitting whatever was active then would be an act on the wrong pane. Close is
 * already pane-exact, so it needs no focus.
 */
export function createPaneHeaderHandlers(deps: PaneHeaderActionDeps): PaneHeaderActionHandlers {
  const focusOwnPane = (paneId: number): boolean => {
    const index = deps.tabIndexOf(paneId);
    if (index < 0) {
      return false;
    }
    deps.focusPane(index, paneId);
    return deps.activePaneId() === paneId;
  };
  return {
    split: (paneId, direction) => {
      if (focusOwnPane(paneId)) {
        deps.splitActive(direction);
      }
    },
    toggleExpand: (paneId) => {
      if (focusOwnPane(paneId)) {
        deps.toggleFocusExpand();
      }
    },
    close: (paneId) => {
      const index = deps.tabIndexOf(paneId);
      if (index >= 0) {
        deps.closePaneAt(index, paneId);
      }
    },
  };
}

const INERT: PaneHeaderActionHandlers = {
  split: () => {},
  toggleExpand: () => {},
  close: () => {},
};

let current: PaneHeaderActionHandlers = INERT;

/** Install `handlers`; the returned disposer restores the inert default if they are still current. */
export function registerPaneHeaderActions(handlers: PaneHeaderActionHandlers): () => void {
  current = handlers;
  return () => {
    if (current === handlers) {
      current = INERT;
    }
  };
}

/** The handlers a button should call right now — read at press time, never captured. */
export function paneHeaderActions(): PaneHeaderActionHandlers {
  return current;
}
