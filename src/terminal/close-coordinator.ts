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
  /**
   * Close ONE named pane of a named tab — the rail's per-agent ✕ (close model,
   * 2026-08-22, table row 1). `closePane()` above is the keyboard's version of
   * the same rule and can only ever mean the focused pane of the ACTIVE tab;
   * the rail points at a pane in a tab that is not selected, which is why this
   * takes both coordinates instead of routing through it.
   *
   * Same contract otherwise: the tab's LAST pane closes the tab, so a pane row
   * and a one-pane tab behave identically (table row 2). `paneCount()`, not
   * the rail's agent-row count — a tab holding one agent beside a plain shell
   * has two panes and survives losing the agent.
   */
  closePaneAt(index: number, paneId: number): Promise<void>;
  /** Close a Tab after Busy guard on every Pane. */
  closeTab(index: number): Promise<void>;
  /**
   * Close SEVERAL tabs as one act — the rail's project-header ✕ (close model,
   * table row 4), which closes every tab of a project including its secondary
   * worktrees.
   *
   * One Busy dialog over the union of every pane, not N dialogs: the user
   * pressed one control, and answering the same question five times is how a
   * confirmation stops being read. Cancelling aborts the WHOLE act — nothing
   * is disposed and `false` comes back, which is what lets the caller hold the
   * project's history entries rather than forgetting a project whose tabs are
   * all still open.
   *
   * The indexes are pinned by identity before the first dispose, so the caller
   * never has to reason about the list shifting under it.
   */
  closeTabs(indexes: readonly number[]): Promise<boolean>;
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

  async function closePaneAt(index: number, paneId: number): Promise<void> {
    const entry = deps.tabAt(index);
    if (!entry) {
      return;
    }
    // Membership FIRST, before any routing. `index` is a coordinate the rail
    // read at render time, and a `pty:exit` closing an earlier tab in between
    // shifts every later one down — so an unvalidated `index` can name a
    // different single-pane tab, and routing to `closeTab` on its pane count
    // would close a tab the user never pressed (silently, since `confirmClose`
    // answers true when nothing is busy). The pane id is the part of the
    // gesture that cannot go stale: no match, no close.
    if (!entry.manager.paneIds().includes(paneId)) {
      return;
    }
    // The tab's last pane IS the tab: route to `closeTab`, which runs its own
    // guard over every pane and takes the reopen snapshot `closePaneById`
    // cannot (table row 2).
    if (entry.manager.paneCount() <= 1) {
      await closeTab(index);
      return;
    }
    if (!(await deps.confirmClose([paneId]))) {
      return;
    }
    // Re-pin after the dialog exactly as `closeTab` does: a concurrent close
    // can have taken the tab, and a pty:exit can have taken the pane.
    if (deps.indexOf(entry) === -1 || !entry.manager.paneIds().includes(paneId)) {
      return;
    }
    await entry.manager.closePaneById(paneId);
  }

  async function closeTabs(indexes: readonly number[]): Promise<boolean> {
    // Identity first, positions never: every dispose below shifts the list,
    // so the indexes are resolved once, here, and not looked at again.
    const entries = indexes
      .map((index) => deps.tabAt(index))
      .filter((entry): entry is { manager: TerminalManager } => entry !== undefined);
    if (entries.length === 0) {
      return false;
    }
    const paneIds = entries.flatMap((entry) => entry.manager.paneIds());
    if (!(await deps.confirmClose(paneIds))) {
      return false;
    }
    for (const entry of entries) {
      const at = deps.indexOf(entry);
      // -1 → a concurrent close already took it; the act still stands.
      if (at !== -1) {
        await deps.disposeTab(at);
      }
    }
    return true;
  }

  return { closePane, closePaneAt, closeTab, closeTabs };
}
