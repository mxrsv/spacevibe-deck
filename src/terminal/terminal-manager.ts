import type { Settings } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
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
} from "../lib/split-tree";
import { nearestInDirection, type FocusDirection } from "../lib/pane-geometry";
import { paneHeaderInfo, type PaneProcessInfo } from "../lib/process-info";
import { shellEscapePaths } from "../lib/shell-escape";
import { getDesktopEnvironment } from "../lib/platform";
import { reportPersistError } from "../chrome/events";
import { createLayoutEngine } from "./layout-engine";
import { createPaneLifecycle, type CreatePaneFn } from "./pane-lifecycle";
import type { Pane, PaneAttentionSignal } from "./pane";
import {
  detachPane,
  type DetachTarget,
  type PaneIdentity,
} from "./pane-detach";
import { adoptTransfer, type AdoptResult } from "./pane-adopt";
import {
  defaultTransferClient,
  type AdoptionPayload,
  type TransferClient,
} from "./transfer-client";
import { clearPaneCwd, paneCwd, setPaneCwd } from "./pane-cwd";
import { freshCwd } from "./pane-info";
import { defaultPtyClient, type PtyClient } from "./pty-client";
import { createPaneDragController, type PaneDragController } from "./pane-drag";
import {
  advanceSearch,
  closeSearchBarForPane,
  openSearchBar,
} from "./search-bar";

export interface ManagerCallbacks {
  /** Fired after any structural change (split, close, ratio commit). */
  onLayoutChange(): void;
  /** Fired when a pane requests attention (OSC 9/777 notification or bell). */
  onAttentionSignal?(id: number, signal: PaneAttentionSignal): void;
  /**
   * Acknowledges a pane as the focus target. `focusPane` guarantees exactly
   * one call, deterministically, regardless of whether DOM focus actually
   * moves. A raw user click/focusin may call this more than once for the
   * same pane (mousedown + focusin both route through it) — downstream
   * `acknowledge` handling is idempotent, so that's fine.
   */
  onPaneFocus?(id: number): void;
}

/** Optional seams forwarded to PaneLifecycle — production uses the defaults. */
export interface TerminalManagerDeps {
  /** Test seam — defaults to real createPane (xterm). */
  createPane?: CreatePaneFn;
  /** Test seam — defaults to the real Tauri transfer client. */
  transfer?: TransferClient;
  /**
   * Tab-level identity for a pane (name override, dot color, workspace).
   * TabManager owns those, so it supplies this; the default carries only
   * what a manager knows on its own.
   */
  identity?: (id: number) => Partial<PaneIdentity>;
}

/**
 * What a detach did to THIS window. `tabEmpty` is what tells TabManager the
 * tab has no panes left, so it can remove it WITHOUT the reopen snapshot
 * `disposeTab` takes — nothing was closed, the session is alive elsewhere.
 */
export type DetachOutcome =
  | { readonly kind: "moved"; readonly tabEmpty: boolean }
  | { readonly kind: "kept"; readonly reason: string };

/**
 * Live-adopt (spec §10.1): insert into the running tab's layout tree at a
 * NAMED position. The single-object signature is frozen at merge
 * reconciliation 2026-08-10 — the drag section calls it with the pane the
 * cursor was over and the edge it was dropped on, which is why the target is
 * explicit rather than "wherever the active pane happens to be".
 */
export interface AdoptIntoActiveTabRequest {
  readonly token: string;
  /** Pane to split; falls back to the active pane, then to an empty tree. */
  readonly targetPaneId?: number;
  readonly edge?: Edge;
}

/**
 * Spawn placeholder geometry, mirroring `pane-lifecycle.ts` — used only when
 * a moving pane vanished mid-call.
 */
const TRANSFER_FALLBACK_COLS = 80;
const TRANSFER_FALLBACK_ROWS = 24;

/** One tab's worth of terminals: a split tree of panes sharing a container. */
export interface TerminalManager {
  /** Spawn a single fresh shell (at `cwd` when given). Throws when the spawn fails. */
  initFresh(cwd?: string | null): Promise<void>;
  /**
   * Spawn one shell per leaf and rebuild the split structure. `cwds` maps to
   * leaves in left-to-right order (missing/null entries → $HOME). Throws when
   * any spawn fails.
   */
  initFromLayout(
    layout: SerializedNode,
    cwds?: readonly (string | null)[],
  ): Promise<void>;
  /**
   * Displays the container and fits every pane. `focus` defaults to `true`
   * (focuses the active pane, matching the historical behavior); internal
   * attention navigation passes `{ focus: false }` to display/fit without
   * stealing focus.
   */
  show(options?: { focus?: boolean }): void;
  hide(): void;
  splitActive(dir: Direction): Promise<void>;
  closeActive(): Promise<void>;
  /** Close a specific pane; unknown id → no-op (it may have exited meanwhile). */
  closePaneById(id: number): Promise<void>;
  /**
   * Move a pane out of this window (spec §10.3). Never kills the PTY, and
   * never respawns a replacement when the tab empties — a moved pane is not a
   * closed one.
   */
  detachPaneById(id: number, target: DetachTarget): Promise<DetachOutcome>;
  /** Boot-adopt: this manager's first tab IS the moved pane (spec §10.1). */
  initFromAdoption(token: string): Promise<AdoptResult>;
  /** Live-adopt: dock the moved pane into the running tab at a named edge. */
  adoptIntoActiveTab(request: AdoptIntoActiveTabRequest): Promise<AdoptResult>;
  cycleFocus(step: 1 | -1): void;
  /** Move focus to the nearest pane in a direction; no pane there → no-op. */
  focusDirection(dir: FocusDirection): void;
  /**
   * Swap the active pane with its neighbor in a direction; no
   * neighbor there → no-op. Unlike `focusDirection`, this rebuilds the DOM
   * (each pane's element must reparent into its new slot) and so — like
   * `splitActive`/`closePane` — unconditionally drops zoom as a side effect
   * of that rebuild, even when the zoomed pane is not the one swapped.
   */
  swapDirection(dir: FocusDirection): void;
  /** Maximize the active pane over the whole tab; call again to restore. */
  toggleZoom(): void;
  focusActive(): void;
  /**
   * Focus a specific pane by id (keeps zoom restore, focus-expand and active
   * classes via `setActive`). Unknown/dead id → no-op, returns `false`.
   */
  focusPane(id: number): boolean;
  /** Clear the active pane's buffer, keeping the prompt line (Cmd+K). */
  clearActive(): void;
  copyActiveSelection(): void;
  pasteIntoActive(): void;
  /**
   * Paste text into ONE pane by id (the Prompt Board targets the pane the
   * popover captured, not whatever is active by the time the user clicks).
   * Null when the pane is unknown or already exited; otherwise resolves with
   * whether the paste frame reached the PTY.
   */
  pasteIntoPane(id: number, text: string): Promise<boolean> | null;
  /**
   * Queue a bare `\r` for one pane, behind whatever it already has queued —
   * which is what makes it land after a paste frame issued moments earlier.
   * Null when the pane is unknown or already exited; otherwise resolves with
   * whether Enter reached the PTY.
   */
  submitPane(id: number): Promise<boolean> | null;
  /** Scroll the active pane's viewport by one page (⇧PageUp/⇧PageDown). */
  scrollActivePage(dir: 1 | -1): void;
  /** Jump the active pane's viewport to the top or bottom of scrollback. */
  scrollActiveToEdge(edge: "top" | "bottom"): void;
  /** Open the search bar on the active pane (Cmd+F). */
  openSearch(): void;
  /**
   * Advance to the next/previous match on the active pane (Cmd+G / Cmd+Shift+G).
   * Works whether the search bar is open on it or already closed — see
   * `advanceSearch` in search-bar.ts.
   */
  findNext(): void;
  findPrevious(): void;
  applySettings(next: Settings): void;
  serializeLayout(): SerializedNode | null;
  paneIds(): number[];
  activePaneId(): number | null;
  paneCount(): number;
  /** Root element of a pane (overlay anchor for the agent picker). */
  paneElement(id: number): HTMLElement | null;
  /** Routed from the tab manager's single pty:output listener; ignores unowned ids. */
  handleOutput(id: number, data: string): void;
  /** Routed from the tab manager's single pty:exit listener; ignores unowned ids. */
  handleExit(id: number): void;
  updatePaneInfo(infos: readonly PaneProcessInfo[], home: string): void;
  /** Write an error line into the active pane (used for tab spawn failures). */
  notifyError(message: string): void;
  /** Highlight the pane under the cursor while dragging files (logical CSS px). */
  fileDragOver(x: number, y: number): void;
  /** Clear any drop-target highlight. */
  fileDragLeave(): void;
  /** Write the (shell-escaped) paths into the PTY of the pane under the cursor. */
  fileDrop(x: number, y: number, paths: string[]): void;
  /** Kills all PTYs, disposes xterm instances and removes the container. */
  dispose(): void;
}

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
  container.classList.toggle("pane-bar-hidden", !settings.value.showPaneBar);

  const life = createPaneLifecycle({
    pty,
    getSettings: () => settings.value,
    createPane: deps.createPane,
    onWriteWhileExited(id, data) {
      if (data === "\r") {
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
    pane.writeln(
      "\r\n\x1b[33m[Session ended — press Enter to start a new one]\x1b[0m",
    );
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

  async function detachPaneById(
    id: number,
    target: DetachTarget,
  ): Promise<DetachOutcome> {
    transferring.add(id);
    try {
      return await runDetach(id, target);
    } finally {
      transferring.delete(id);
    }
  }

  async function runDetach(
    id: number,
    target: DetachTarget,
  ): Promise<DetachOutcome> {
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
    if (result.kind === "kept") {
      return result;
    }
    const tabEmpty = tree === null;
    callbacks.onLayoutChange();
    return { kind: "moved", tabEmpty };
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

  function adoptIntoActiveTab(
    request: AdoptIntoActiveTabRequest,
  ): Promise<AdoptResult> {
    const edge = request.edge ?? "right";
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
      life.panes
        .get(targetId)
        ?.writeln(`\r\n\x1b[31mFailed to open new pane: ${err}\x1b[0m`);
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
    if (data === "") {
      return;
    }
    pty.writePty(id, data).catch(() => {
      reportPersistError(
        "Couldn't send input to the terminal — the session may have ended.",
      );
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
      return (
        life.panes.get(id)?.element.querySelector(".pane__cwd")?.textContent ||
        "pane"
      );
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
      container.style.display = "";
      for (const pane of life.panes.values()) {
        pane.fit();
      }
      if ((options?.focus ?? true) && activeId !== null) {
        life.panes.get(activeId)?.focus();
      }
    },
    hide() {
      container.style.display = "none";
    },
    splitActive,
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
      return life.enqueueWrite(id, "\r");
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
          advanceSearch(pane, "next");
        }
      }
    },
    findPrevious() {
      if (activeId !== null) {
        const pane = life.panes.get(activeId);
        if (pane) {
          advanceSearch(pane, "previous");
        }
      }
    },
    applySettings(next) {
      container.classList.toggle("pane-bar-hidden", !next.showPaneBar);
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
