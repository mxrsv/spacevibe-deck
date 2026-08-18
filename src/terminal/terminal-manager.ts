import { settings } from '../settings/settings-store';
import {
  countLeaves,
  dockNewPane,
  leaf,
  leafIds,
  movePane,
  removeLeaf,
  serializeTree,
  setRatio,
  splitLeaf,
  swapLeaves,
  treeFromLayout,
  type Direction,
  type Edge,
  type SerializedNode,
  type TreeNode,
} from '../lib/split-tree';
import { nearestInDirection, type FocusDirection } from '../lib/pane-geometry';
import { paneHeaderInfo } from '../lib/process-info';
import { shellEscapePaths } from '../lib/shell-escape';
import { getDesktopEnvironment } from '../lib/platform';
import { reportPersistError } from '../chrome/events';
import { createLayoutEngine } from './layout-engine';
import { createPaneLifecycle } from './pane-lifecycle';
import type { Pane } from './pane';
import { detachPane, type DetachTarget } from './pane-detach';
import { adoptTransfer, type AdoptResult } from './pane-adopt';
import { defaultTransferClient, type AdoptionPayload } from './transfer-client';
import { clearPaneCwd, paneCwd, setPaneCwd } from './pane-cwd';
import { freshCwd } from './pane-info';
import { defaultPtyClient, type PtyClient } from './pty-client';
import { createPaneDragController, type PaneDragController } from './pane-drag';
import { advanceSearch, closeSearchBarForPane, openSearchBar } from './search-bar';
import {
  TRANSFER_FALLBACK_COLS,
  TRANSFER_FALLBACK_ROWS,
  type AdoptIntoActiveTabRequest,
  type DetachOutcome,
  type ManagerCallbacks,
  type TerminalManager,
  type TerminalManagerDeps,
} from './terminal-manager-types';

// Re-exported so existing consumers (tab-manager.ts, close-coordinator.ts,
// terminal-manager.test.ts) keep importing types from this module's own
// path unchanged after the type/interface header moved out to
// terminal-manager-types.ts.
export {
  type AdoptIntoActiveTabRequest,
  type DetachOutcome,
  type ManagerCallbacks,
  type TerminalManager,
  type TerminalManagerDeps,
};

export function createTerminalManager(
  container: HTMLElement,
  callbacks: ManagerCallbacks,
  pty: PtyClient = defaultPtyClient,
  deps: TerminalManagerDeps = {},
): TerminalManager {
  let tree: TreeNode | null = null;
  let activeId: number | null = null;
  // Guards the onFocus-driven ack while focusPane runs its own deterministic
  // one — pane.focus() may or may not bubble a native `focusin` (a no-op on
  // an element that already holds DOM focus never fires one), so the
  // lifecycle handler must not double- or zero-emit around it.
  let inProgrammaticFocus = false;

  // Pane bar visibility is CSS-only: pane.ts always builds and populates the
  // bar (the drag ghost and anchor still read its cwd) — this class hides it.
  container.classList.toggle('pane-bar-hidden', !settings.value.showPaneBar);

  const life = createPaneLifecycle({
    pty,
    getSettings: () => settings.value,
    createPane: deps.createPane,
    onWriteWhileExited(id, data) {
      if (data === '\r') {
        void respawn(id);
      }
    },
    onFocus(id) {
      setActive(id);
      // While focusPane is driving this focus, it owns the single ack —
      // suppress the bubbled-event ack so the two don't stack.
      if (!inProgrammaticFocus) {
        callbacks.onPaneFocus?.(id);
      }
    },
    onAttentionSignal(id, signal) {
      callbacks.onAttentionSignal?.(id, signal);
    },
  });

  const layout = createLayoutEngine(container, {
    getPaneElement: (id) => life.panes.get(id)?.element,
    mountPane: (id) => {
      life.panes.get(id)?.mount();
    },
    fitPane: (id) => {
      life.panes.get(id)?.fit();
    },
    focusPane: (id) => {
      life.panes.get(id)?.focus();
    },
  });

  function overlayInput() {
    if (!tree) {
      return null;
    }
    return {
      tree,
      activeId,
      paneCount: life.panes.size,
      focusExpand: settings.value.focusExpand,
    };
  }

  function render(): void {
    if (!tree) {
      return;
    }
    layout.sync({
      tree,
      activeId,
      paneCount: life.panes.size,
      focusExpand: settings.value.focusExpand,
      onRatioCommit(path, ratio) {
        if (!tree) {
          return;
        }
        tree = setRatio(tree, path, ratio);
        const overlay = overlayInput();
        if (overlay) {
          layout.refreshOverlay(overlay);
        }
        callbacks.onLayoutChange();
      },
    });
  }

  function setActive(id: number): void {
    if (activeId === id) {
      return;
    }
    // Moving focus while zoomed restores the layout (tmux behavior)
    if (layout.zoomedId() !== null && layout.zoomedId() !== id) {
      layout.unzoom();
    }
    activeId = id;
    const overlay = overlayInput();
    if (overlay) {
      layout.refreshOverlay(overlay);
    }
  }

  function handleExit(id: number): void {
    const pane = life.panes.get(id);
    if (!pane) {
      return;
    }
    if (life.panes.size > 1) {
      // Shell exited (typed exit / process died) → auto-close that pane
      void closePane(id);
      return;
    }
    life.exited.add(id);
    pane.writeln('\r\n\x1b[33m[Session ended — press Enter to start a new one]\x1b[0m');
  }

  async function respawn(oldId: number): Promise<void> {
    if (!tree) {
      return;
    }
    const result = await life.respawn(oldId, tree, activeId);
    if (result === null) {
      return;
    }
    tree = result.tree;
    activeId = result.activeId;
    // Mount (term.open) then focus — same order as pre-extraction respawn.
    render();
    if (activeId !== null) {
      life.panes.get(activeId)?.focus();
    }
  }

  async function closePane(id: number): Promise<void> {
    const pane = life.panes.get(id);
    if (!pane || !tree) {
      return;
    }
    // Rust rejects `kill_pty` for a pane whose route is `Transferring` (spec
    // §8), and `killPane` swallows that rejection. Without this guard the
    // pane and its subtree are removed anyway: if the transfer then aborts,
    // the agent comes back to this window owning a PTY with no UI attached —
    // a process running where nobody can see or stop it.
    if (transferring.has(id)) {
      reportPersistError("This pane is being moved — it can't be closed yet.");
      return;
    }
    life.killPane(id);
    life.panes.delete(id);
    life.exited.delete(id);
    clearPaneCwd(id);
    closeSearchBarForPane(id);
    pane.dispose();

    const rest = removeLeaf(tree, id);
    if (rest === null) {
      // Last pane in the tab — always keep at least one terminal
      tree = null;
      activeId = null;
      await openInitialPane();
      callbacks.onLayoutChange();
      return;
    }
    tree = rest;
    if (activeId === id) {
      activeId = leafIds(tree)[0] ?? null;
    }
    render();
    if (activeId !== null) {
      life.panes.get(activeId)?.focus();
    }
    callbacks.onLayoutChange();
  }

  const transfer = deps.transfer ?? defaultTransferClient;
  /**
   * Panes with an open transfer. Local knowledge on purpose: Rust owns the
   * route, but only this manager knows it started the move, and `closePane`
   * needs the answer synchronously.
   */
  const transferring = new Set<number>();

  /**
   * Remove a pane from this window because it MOVED, not because it closed.
   * Deliberately not `closePane`: that one kills the PTY and respawns a
   * shell when the tab's last pane goes away (spec §10.3). The pruning
   * `closePane`/`disposeTab` normally do has to be spelled out here for the
   * same reason.
   */
  function releaseMovedPane(id: number): void {
    closeSearchBarForPane(id);
    life.releasePane(id);
    if (!tree) {
      return;
    }
    const rest = removeLeaf(tree, id);
    if (rest === null) {
      tree = null;
      activeId = null;
      return;
    }
    tree = rest;
    if (activeId === id) {
      activeId = leafIds(tree)[0] ?? null;
    }
    render();
    if (activeId !== null) {
      life.panes.get(activeId)?.focus();
    }
  }

  /**
   * Capture-time geometry for a moving pane (spec §10.2). Falls back to the
   * spawn placeholder for a pane that vanished mid-call; the destination
   * re-fits after commit anyway, so this is a starting point, not a
   * constraint.
   */
  function paneGeometry(id: number): { cols: number; rows: number } {
    const pane = life.panes.get(id);
    return {
      cols: pane?.cols ?? TRANSFER_FALLBACK_COLS,
      rows: pane?.rows ?? TRANSFER_FALLBACK_ROWS,
    };
  }

  async function detachPaneById(id: number, target: DetachTarget): Promise<DetachOutcome> {
    transferring.add(id);
    try {
      return await runDetach(id, target);
    } finally {
      transferring.delete(id);
    }
  }

  async function runDetach(id: number, target: DetachTarget): Promise<DetachOutcome> {
    const result = await detachPane(id, target, {
      transfer,
      drainWrites: (paneId) => life.drainWrites(paneId),
      holdWrites: (paneId) => life.holdWrites(paneId),
      pane: (paneId) => life.panes.get(paneId),
      geometry: paneGeometry,
      identity: (paneId) => ({
        cwd: paneCwd(paneId),
        agentId: null,
        tabName: null,
        dotColor: null,
        workspacePath: null,
        ...deps.identity?.(paneId),
      }),
      release: releaseMovedPane,
      report: reportPersistError,
    });
    if (result.kind === 'kept') {
      return result;
    }
    const tabEmpty = tree === null;
    callbacks.onLayoutChange();
    return { kind: 'moved', tabEmpty };
  }

  function adoptDeps(place: (pane: Pane, payload: AdoptionPayload) => void) {
    return {
      transfer,
      holdWrites: (paneId: number) => life.holdWrites(paneId),
      adopt: (payload: AdoptionPayload) => life.adoptPane(payload),
      place,
      discard: (paneId: number) => life.releasePane(paneId),
      report: reportPersistError,
    };
  }

  /** Boot-adopt (spec §10.1): this manager's FIRST tab is the moved pane. */
  function initFromAdoption(token: string): Promise<AdoptResult> {
    return adoptTransfer(
      token,
      adoptDeps((pane) => {
        tree = leaf(pane.id);
        activeId = pane.id;
        render();
        pane.focus();
      }),
    );
  }

  function adoptIntoActiveTab(request: AdoptIntoActiveTabRequest): Promise<AdoptResult> {
    const edge = request.edge ?? 'right';
    return adoptTransfer(
      request.token,
      adoptDeps((pane) => {
        const anchor = request.targetPaneId ?? activeId;
        // `dockNewPane`, NOT `splitLeaf`: `splitLeaf` always appends to slot
        // `b`, so a "left" or "top" dock would land on the wrong side, and
        // `movePane` is a no-op for a pane not already in this tree.
        tree =
          tree === null || anchor === null
            ? leaf(pane.id)
            : dockNewPane(tree, anchor, pane.id, edge);
        activeId = pane.id;
        render();
        pane.focus();
        callbacks.onLayoutChange();
      }),
    );
  }

  async function openInitialPane(): Promise<void> {
    await life.openInitial(
      (nextTree, nextActive) => {
        tree = nextTree;
        activeId = nextActive;
        render();
      },
      (err) => {
        container.textContent = `Failed to start shell: ${err}`;
      },
    );
  }

  async function splitActive(dir: Direction): Promise<void> {
    if (!tree || activeId === null) {
      return;
    }
    const targetId = activeId;
    try {
      // Fresh lookup, not the 2s poll cache — the user may have just cd'd
      const cwd = await freshCwd(targetId, pty);
      const pane = await life.spawnPane(cwd);
      if (!life.isInTree(tree, targetId)) {
        // Target pane closed while spawning — drop the new session
        life.discardPane(pane);
        return;
      }
      tree = splitLeaf(tree, targetId, pane.id, dir);
      // Assign directly instead of setActive: setActive applies ratios to the
      // DOM, which does not match the just-split tree until render() runs.
      activeId = pane.id;
      render();
      pane.focus();
      callbacks.onLayoutChange();
    } catch (err) {
      life.panes.get(targetId)?.writeln(`\r\n\x1b[31mFailed to open new pane: ${err}\x1b[0m`);
    }
  }

  /**
   * Dock a fresh pane on `edge` of `targetPaneId` (the `New` row dropped onto
   * a pane). Returns the new pane's id so the caller can arm an agent command
   * on it; `null` means nothing was created and nothing should be armed.
   *
   * `dockNewPane`, NOT `splitLeaf`: `splitLeaf` takes a direction and always
   * appends to branch `b`, so a drop on the left or top edge would land on the
   * wrong side — the same reason `adoptIntoActiveTab` above uses it.
   */
  async function dockNewPaneAt(targetPaneId: number, edge: Edge): Promise<number | null> {
    if (!tree || !life.isInTree(tree, targetPaneId)) {
      return null;
    }
    try {
      // Fresh lookup, not the 2s poll cache — the user may have just cd'd.
      const cwd = await freshCwd(targetPaneId, pty);
      const pane = await life.spawnPane(cwd);
      if (!tree || !life.isInTree(tree, targetPaneId)) {
        // Target closed while spawning — drop the new session rather than
        // dock it somewhere the user never pointed at.
        life.discardPane(pane);
        return null;
      }
      tree = dockNewPane(tree, targetPaneId, pane.id, edge);
      // Assigned directly rather than through setActive, for the same reason
      // splitActive does: ratios do not match the just-docked tree until
      // render() runs.
      activeId = pane.id;
      render();
      pane.focus();
      callbacks.onLayoutChange();
      return pane.id;
    } catch (err) {
      life.panes.get(targetPaneId)?.writeln(`\r\n\x1b[31mFailed to open new pane: ${err}\x1b[0m`);
      return null;
    }
  }

  function cycleFocus(step: 1 | -1): void {
    if (!tree || activeId === null) {
      return;
    }
    const ids = leafIds(tree);
    const index = ids.indexOf(activeId);
    const next = ids[(index + step + ids.length) % ids.length];
    setActive(next);
    life.panes.get(next)?.focus();
  }

  function focusDirection(dir: FocusDirection): void {
    if (!tree || activeId === null) {
      return;
    }
    const target = nearestInDirection(layout.slotRects(), activeId, dir);
    if (target === null) {
      return;
    }
    // Route through setActive so zoom restore, active classes and expand
    // ratios are inherited rather than re-derived.
    setActive(target);
    life.panes.get(target)?.focus();
  }

  function swapDirection(dir: FocusDirection): void {
    if (!tree || activeId === null) {
      return;
    }
    const target = nearestInDirection(layout.slotRects(), activeId, dir);
    if (target === null) {
      return; // no neighbor in that direction
    }
    const next = swapLeaves(tree, activeId, target);
    if (next === tree) {
      return;
    }
    tree = next;
    render();
    // activeId is unchanged (only its slot moved) — focus follows it.
    // Not routed through setActive: activeId === activeId is
    // always a no-op there, so this calls pane.focus() directly, same as
    // pane-drag.ts's onSwap below does after its own swapLeaves.
    life.panes.get(activeId)?.focus();
    callbacks.onLayoutChange();
  }

  async function initFresh(cwd: string | null = null): Promise<void> {
    const pane = await life.spawnPane(cwd);
    tree = leaf(pane.id);
    activeId = pane.id;
    render();
    pane.focus();
  }

  async function initFromLayout(
    layoutNode: SerializedNode,
    cwds: readonly (string | null)[] = [],
  ): Promise<void> {
    const total = countLeaves(layoutNode);
    const spawned: Awaited<ReturnType<typeof life.spawnPane>>[] = [];
    try {
      for (let i = 0; i < total; i += 1) {
        spawned.push(await life.spawnPane(cwds[i] ?? null));
      }
    } catch (err) {
      for (const pane of spawned) {
        life.discardPane(pane);
      }
      throw err;
    }
    tree = treeFromLayout(
      layoutNode,
      spawned.map((pane) => pane.id),
    );
    activeId = spawned[0]?.id ?? null;
    render();
    spawned[0]?.focus();
  }

  function fileDragOver(x: number, y: number): void {
    if (layout.zoomedId() !== null) {
      layout.setDropTarget(null);
      return; // overlay covers the slots — the drop always hits the zoomed pane
    }
    layout.setDropTarget(layout.paneIdAt(x, y));
  }

  function fileDragLeave(): void {
    layout.setDropTarget(null);
  }

  function fileDrop(x: number, y: number, paths: string[]): void {
    layout.setDropTarget(null);
    // While zoomed the overlay covers every slot — the drop belongs to the
    // zoomed pane, not whatever slot happens to sit underneath the cursor.
    const id = layout.zoomedId() ?? layout.paneIdAt(x, y);
    if (id === null) {
      return; // dropped outside every pane (tab bar / status bar) — ignore
    }
    if (!life.panes.has(id) || life.exited.has(id)) {
      return; // pane already exited — never write into a dead PTY
    }
    const data = shellEscapePaths(paths, getDesktopEnvironment().platform);
    if (data === '') {
      return;
    }
    pty.writePty(id, data).catch(() => {
      reportPersistError("Couldn't send input to the terminal — the session may have ended.");
    });
    setActive(id);
    life.panes.get(id)?.focus();
  }

  const paneDrag: PaneDragController = createPaneDragController(container, {
    paneCount: () => life.panes.size,
    paneIdForElement(el) {
      for (const pane of life.panes.values()) {
        if (pane.element.contains(el)) {
          return pane.id;
        }
      }
      return null;
    },
    slotRects: () => layout.slotRects(),
    ghostLabel(id) {
      return life.panes.get(id)?.element.querySelector('.pane__cwd')?.textContent || 'pane';
    },
    onMove(sourceId: number, targetId: number, edge: Edge) {
      if (!tree) {
        return;
      }
      const next = movePane(tree, sourceId, targetId, edge);
      if (next === tree) {
        return; // no-op: invalid ids, or source/target closed mid-drag
      }
      tree = next;
      render();
      setActive(sourceId);
      life.panes.get(sourceId)?.focus();
      callbacks.onLayoutChange();
    },
    onSwap(sourceId: number, targetId: number) {
      if (!tree) {
        return;
      }
      const next = swapLeaves(tree, sourceId, targetId);
      if (next === tree) {
        return; // no-op: same pane, or one closed mid-drag
      }
      tree = next;
      render();
      setActive(sourceId);
      life.panes.get(sourceId)?.focus();
      callbacks.onLayoutChange();
    },
  });

  return {
    initFresh,
    initFromLayout,
    show(options) {
      container.style.display = '';
      for (const pane of life.panes.values()) {
        pane.fit();
      }
      if ((options?.focus ?? true) && activeId !== null) {
        life.panes.get(activeId)?.focus();
      }
    },
    hide() {
      container.style.display = 'none';
    },
    splitActive,
    dockNewPaneAt,
    /**
     * Zoom is why this is not a bare `layout.slotRects()`: the zoom overlay
     * reparents ONE pane over the whole tab while every `.pane-slot` of the
     * hidden grid keeps its geometry, so the raw list would let a drag paint
     * an edge overlay on a pane nobody can see and dock against it. Collapsed
     * to the one pane actually on screen, at the container's own rect — the
     * same reading `fileDrop` takes with `zoomedId() ?? paneIdAt(x, y)`.
     * Docking drops zoom as a side effect of `render()`, exactly as a split
     * does.
     */
    slotRects() {
      const zoomed = layout.zoomedId();
      if (zoomed === null) {
        return layout.slotRects();
      }
      const rect = container.getBoundingClientRect();
      return [
        {
          id: zoomed,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      ];
    },
    closeActive() {
      return activeId === null ? Promise.resolve() : closePane(activeId);
    },
    closePaneById(id) {
      return closePane(id);
    },
    detachPaneById,
    initFromAdoption,
    adoptIntoActiveTab,
    cycleFocus,
    focusDirection,
    swapDirection,
    toggleZoom() {
      layout.toggleZoom(activeId, life.panes.size);
    },
    focusActive() {
      if (activeId !== null) {
        life.panes.get(activeId)?.focus();
      }
    },
    focusPane(id) {
      const pane = life.panes.get(id);
      if (!pane) {
        return false;
      }
      inProgrammaticFocus = true;
      try {
        setActive(id);
        // May or may not bubble a native `focusin` (none fires when `id`
        // already holds DOM focus) — either way the ack below is the only
        // one that counts, since the lifecycle handler suppresses its own
        // while this flag is set.
        pane.focus();
      } finally {
        inProgrammaticFocus = false;
      }
      callbacks.onPaneFocus?.(id);
      return true;
    },
    clearActive() {
      if (activeId !== null) {
        life.panes.get(activeId)?.clear();
      }
    },
    copyActiveSelection() {
      if (activeId !== null) {
        life.panes.get(activeId)?.copySelection();
      }
    },
    pasteIntoActive() {
      if (activeId !== null) {
        life.panes.get(activeId)?.paste();
      }
    },
    pasteIntoPane(id, text) {
      const pane = life.panes.get(id);
      if (!pane || life.exited.has(id)) {
        return null;
      }
      return pane.pasteText(text);
    },
    submitPane(id) {
      if (!life.panes.has(id) || life.exited.has(id)) {
        return null;
      }
      return life.enqueueWrite(id, '\r');
    },
    scrollActivePage(dir) {
      if (activeId !== null) {
        life.panes.get(activeId)?.scrollPage(dir);
      }
    },
    scrollActiveToEdge(edge) {
      if (activeId !== null) {
        life.panes.get(activeId)?.scrollToEdge(edge);
      }
    },
    openSearch() {
      if (activeId !== null) {
        const pane = life.panes.get(activeId);
        if (pane) {
          openSearchBar(pane);
        }
      }
    },
    findNext() {
      if (activeId !== null) {
        const pane = life.panes.get(activeId);
        if (pane) {
          advanceSearch(pane, 'next');
        }
      }
    },
    findPrevious() {
      if (activeId !== null) {
        const pane = life.panes.get(activeId);
        if (pane) {
          advanceSearch(pane, 'previous');
        }
      }
    },
    applySettings(next) {
      container.classList.toggle('pane-bar-hidden', !next.showPaneBar);
      for (const pane of life.panes.values()) {
        pane.applySettings(next);
      }
      // Idempotent: mode off → display tree is the original, so this also
      // restores the original layout when the toggle turns off.
      const overlay = overlayInput();
      if (overlay) {
        layout.refreshOverlay({ ...overlay, focusExpand: next.focusExpand });
      }
    },
    serializeLayout() {
      return tree === null ? null : serializeTree(tree);
    },
    paneIds() {
      return tree === null ? [] : leafIds(tree);
    },
    activePaneId() {
      return activeId;
    },
    paneCount() {
      return life.panes.size;
    },
    paneElement(id) {
      return life.panes.get(id)?.element ?? null;
    },
    handleOutput(id, data) {
      life.panes.get(id)?.write(data);
    },
    handleExit,
    updatePaneInfo(infos, home) {
      for (const info of infos) {
        const pane = life.panes.get(info.id);
        if (!pane) {
          continue;
        }
        pane.setHeaderInfo(paneHeaderInfo(info, home));
        // The header shows a tildified cwd; the link provider needs the raw
        // one to resolve the relative paths an agent prints.
        if (info.cwd !== null) {
          setPaneCwd(info.id, info.cwd);
        }
      }
    },
    notifyError(message) {
      if (activeId !== null) {
        life.panes.get(activeId)?.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      }
    },
    fileDragOver,
    fileDragLeave,
    fileDrop,
    dispose() {
      paneDrag.dispose();
      layout.unzoom();
      life.killAll();
      for (const pane of life.panes.values()) {
        clearPaneCwd(pane.id);
        closeSearchBarForPane(pane.id);
        pane.dispose();
      }
      life.panes.clear();
      container.remove();
    },
  };
}
