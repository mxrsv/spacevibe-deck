import type { TerminalManager } from "./terminal-manager";

/**
 * Dependencies the Close coordinator needs from TabManager.
 * Keeps Busy confirmation and dispose/quit behind one interface.
 */
export interface CloseCoordinatorDeps {
  /** Fresh Busy check + native dialog; true → proceed. */
  confirmClose(paneIds: readonly number[]): Promise<boolean>;
  activeManager(): TerminalManager | null;
  activeIndex(): number;
  tabAt(index: number): { manager: TerminalManager } | undefined;
  /** Index of a tab entry after the dialog may have shifted the list. */
  indexOf(entry: { manager: TerminalManager }): number;
  /** Dispose + Closed tab snapshot + last-tab quit. Already unguarded. */
  disposeTab(index: number): Promise<void>;
}

export interface CloseCoordinator {
  /**
   * Cmd+W (iTerm2): last pane in the Tab → close the Tab;
   * otherwise close the Focused pane. One Busy dialog on the final target.
   */
  closePane(): Promise<void>;
  /** Close a Tab after Busy guard on every Pane. */
  closeTab(index: number): Promise<void>;
}

/**
 * Deep Close lifecycle: routing, post-dialog ID pin, Busy guard.
 * Auto-exit in TerminalManager stays outside — it is not a user Close.
 */
export function createCloseCoordinator(deps: CloseCoordinatorDeps): CloseCoordinator {
  async function closeTab(index: number): Promise<void> {
    const entry = deps.tabAt(index);
    if (!entry) {
      return;
    }
    if (!(await deps.confirmClose(entry.manager.paneIds()))) {
      return;
    }
    const currentIndex = deps.indexOf(entry);
    if (currentIndex === -1) {
      return;
    }
    await deps.disposeTab(currentIndex);
  }

  async function closePane(): Promise<void> {
    const manager = deps.activeManager();
    if (!manager) {
      return;
    }
    if (manager.paneCount() <= 1) {
      await closeTab(deps.activeIndex());
      return;
    }
    const paneId = manager.activePaneId();
    if (paneId === null) {
      return;
    }
    if (!(await deps.confirmClose([paneId]))) {
      return;
    }
    // Close the pane the user confirmed, not whichever is active now —
    // a pty:exit during the dialog can move focus to a different pane.
    await manager.closePaneById(paneId);
  }

  return { closePane, closeTab };
}
