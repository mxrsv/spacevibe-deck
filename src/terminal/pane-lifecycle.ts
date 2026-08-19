import type { Settings } from "../settings/settings-schema";
import { reportPersistError } from "../chrome/events";
import { leaf, leafIds, replaceLeaf, type TreeNode } from "../lib/split-tree";
import { createPane, type Pane, type PaneAttentionSignal, type PaneEvents } from "./pane";
import { clearPaneCwd, setPaneCwd } from "./pane-cwd";
import type { PtyClient } from "./pty-client";
import type { AdoptionPayload } from "./transfer-client";

// Placeholder size at spawn — fit() after mount resizes to the real dimensions
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

/** Pane factory seam — real xterm in production, fakes in tests. */
export type CreatePaneFn = (
  id: number,
  initial: Settings,
  events: PaneEvents,
  geometry?: { readonly cols: number; readonly rows: number },
) => Pane;

export interface PaneLifecycle {
  readonly panes: Map<number, Pane>;
  readonly exited: Set<number>;
  spawnPane(cwd?: string | null): Promise<Pane>;
  discardPane(pane: Pane): void;
  adoptPane(payload: AdoptionPayload): Pane;
  /** Forget a pane without killing its PTY — the move's source side. */
  releasePane(id: number): void;
  killPane(id: number): void;
  killAll(): void;
  isInTree(tree: TreeNode | null, id: number): boolean;
  respawn(
    oldId: number,
    tree: TreeNode,
    activeId: number | null,
  ): Promise<{ tree: TreeNode; activeId: number | null } | null>;
  openInitial(
    onTree: (tree: TreeNode, activeId: number) => void,
    onError: (err: unknown) => void,
  ): Promise<void>;
  paneEvents: PaneEvents;
  /**
   * Queue one write for a pane, behind everything already queued for it.
   * `onData` uses this too, which is what makes "paste frame, then `\r`"
   * ordered by construction rather than by a timeout. Resolves true only when
   * this exact write reaches the PTY.
   */
  enqueueWrite(id: number, data: string): Promise<boolean>;
  /** Await everything already queued for this pane; see the implementation. */
  drainWrites(id: number): Promise<void>;
  /** Park new PTY writes for this pane; the returned function releases them. */
  holdWrites(id: number): () => void;
}

/**
 * Deep Pane PTY lifecycle: spawn / kill / respawn / exit limbo.
 * Layout tree ownership stays with TerminalManager.
 */
export function createPaneLifecycle(deps: {
  pty: PtyClient;
  getSettings: () => Settings;
  onWriteWhileExited: (id: number, data: string) => void;
  onFocus: (id: number) => void;
  onAttentionSignal?: (id: number, signal: PaneAttentionSignal) => void;
  /** Test seam — defaults to real createPane (xterm). */
  createPane?: CreatePaneFn;
}): PaneLifecycle {
  const panes = new Map<number, Pane>();
  const exited = new Set<number>();
  const respawning = new Set<number>();
  const makePane = deps.createPane ?? createPane;

  /**
   * Per-pane write chain. `pty.writePty` is fire-and-forget over IPC, so two
   * writes issued back to back have no ordering guarantee — a `\r` could
   * reach the PTY before the paste frame it is meant to submit. Chaining each
   * write behind the previous one's settled promise makes the order
   * structural; no timers, no arbitrary delays.
   */
  const writeChains = new Map<number, Promise<void>>();

  /**
   * Per-pane write gate. During a transfer Rust rejects `write_pty` from
   * every caller (spec §8), so input queued in that window must WAIT, not
   * fail — a rejected write would otherwise surface as "the session may have
   * ended" for a pane that is merely mid-handoff. Awaited inside the chain,
   * which is what keeps FIFO order across the pause.
   */
  const writeHolds = new Map<number, Promise<void>>();

  function enqueueWrite(id: number, data: string): Promise<boolean> {
    if (exited.has(id)) {
      deps.onWriteWhileExited(id, data);
      return Promise.resolve(false);
    }
    const tail = writeChains.get(id) ?? Promise.resolve();
    const result = tail.then(async () => {
      // Re-checked at drain time, not only at enqueue time: the pane may have
      // exited or closed while this write waited its turn.
      if (exited.has(id) || !panes.has(id)) {
        return false;
      }
      await writeHolds.get(id);
      // Re-checked again after the gate: a transfer can outlive this pane in
      // THIS window — the source releases it the moment the move commits.
      if (exited.has(id) || !panes.has(id)) {
        return false;
      }
      try {
        await deps.pty.writePty(id, data);
        return true;
      } catch {
        reportPersistError("Couldn't send input to the terminal — the session may have ended.");
        return false;
      }
    });
    // Sequencing stays usable after one failed write; callers that need a
    // dependent write (Prompt Board paste -> Enter) inspect `result` instead.
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    writeChains.set(id, settled);
    void settled.finally(() => {
      if (writeChains.get(id) === settled) {
        writeChains.delete(id);
      }
    });
    return result;
  }

  /**
   * Resolves once everything already queued for this pane has settled.
   * Deliberately snapshots the tail rather than looping: a detach drains
   * BEFORE it installs a hold, because a hold is awaited inside the chain and
   * draining a held chain would never resolve.
   */
  function drainWrites(id: number): Promise<void> {
    return writeChains.get(id) ?? Promise.resolve();
  }

  function holdWrites(id: number): () => void {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    writeHolds.set(id, gate);
    return () => {
      if (writeHolds.get(id) === gate) {
        writeHolds.delete(id);
      }
      open();
    };
  }

  const paneEvents: PaneEvents = {
    onData(id, data) {
      return enqueueWrite(id, data);
    },
    onResize(id, cols, rows) {
      if (exited.has(id)) {
        return;
      }
      deps.pty.resizePty(id, cols, rows).catch(() => {
        // Session closed mid-flight — ignore
      });
    },
    onFocus(id) {
      deps.onFocus(id);
    },
    onAttentionSignal(id, signal) {
      deps.onAttentionSignal?.(id, signal);
    },
  };

  async function spawnPane(cwd: string | null = null): Promise<Pane> {
    const id = await deps.pty.spawnShell({
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      cwd,
    });
    const pane = makePane(id, deps.getSettings(), paneEvents);
    panes.set(id, pane);
    // Seed the link provider's cwd — the pty_info poll only refreshes it 2s
    // later, and a path clicked before then would resolve against the wrong dir.
    setPaneCwd(id, cwd);
    return pane;
  }

  function discardPane(pane: Pane): void {
    deps.pty.killPty(pane.id).catch(() => {
      // Session already gone — ignore
    });
    panes.delete(pane.id);
    clearPaneCwd(pane.id);
    pane.dispose();
  }

  /**
   * Build a pane around a PTY that ALREADY EXISTS, handed over from another
   * window. `spawnPane` without the spawn: no `spawn_shell`, and the pane is
   * constructed at the source's capture geometry so nothing has to resize
   * before the transfer commits (Rust rejects `resize_pty` while the route is
   * `Transferring` — spec §8).
   */
  function adoptPane(payload: AdoptionPayload): Pane {
    const pane = makePane(payload.paneId, deps.getSettings(), paneEvents, {
      cols: payload.cols,
      rows: payload.rows,
    });
    panes.set(payload.paneId, pane);
    // Same reason as spawnPane: the link provider resolves relative paths
    // against this before the first pty_info poll lands, 2s later.
    setPaneCwd(payload.paneId, payload.cwd);
    return pane;
  }

  /**
   * Forget a pane WITHOUT killing its PTY — the process now belongs to
   * another window (spec §10.3). `discardPane`'s twin minus `killPty`; the
   * difference is the whole point, so do not "simplify" the two together.
   */
  function releasePane(id: number): void {
    const pane = panes.get(id);
    if (!pane) {
      return;
    }
    panes.delete(id);
    exited.delete(id);
    clearPaneCwd(id);
    pane.dispose();
  }

  function killPane(id: number): void {
    deps.pty.killPty(id).catch(() => {
      // Session already ended on its own — ignore
    });
  }

  function killAll(): void {
    for (const pane of panes.values()) {
      deps.pty.killPty(pane.id).catch(() => {
        // Session already gone — ignore
      });
    }
  }

  function isInTree(tree: TreeNode | null, id: number): boolean {
    return tree !== null && panes.has(id) && leafIds(tree).includes(id);
  }

  async function respawn(
    oldId: number,
    tree: TreeNode,
    activeId: number | null,
  ): Promise<{ tree: TreeNode; activeId: number | null } | null> {
    if (respawning.has(oldId)) {
      return null;
    }
    const old = panes.get(oldId);
    if (!old) {
      return null;
    }
    respawning.add(oldId);
    try {
      const fresh = await spawnPane();
      if (!isInTree(tree, oldId)) {
        discardPane(fresh);
        return null;
      }
      const nextTree = replaceLeaf(tree, oldId, fresh.id);
      panes.delete(oldId);
      exited.delete(oldId);
      clearPaneCwd(oldId);
      old.dispose();
      // Caller must focus after layout mount/render — term.open() runs in mount().
      return {
        tree: nextTree,
        activeId: activeId === oldId ? fresh.id : activeId,
      };
    } catch (err) {
      if (panes.has(oldId)) {
        old.writeln(`\r\n\x1b[31mFailed to start shell: ${err}\x1b[0m`);
      }
      return null;
    } finally {
      respawning.delete(oldId);
    }
  }

  async function openInitial(
    onTree: (tree: TreeNode, activeId: number) => void,
    onError: (err: unknown) => void,
  ): Promise<void> {
    try {
      const pane = await spawnPane();
      onTree(leaf(pane.id), pane.id);
      pane.focus();
    } catch (err) {
      onError(err);
    }
  }

  return {
    panes,
    exited,
    spawnPane,
    discardPane,
    adoptPane,
    releasePane,
    killPane,
    killAll,
    isInTree,
    respawn,
    openInitial,
    paneEvents,
    enqueueWrite,
    drainWrites,
    holdWrites,
  };
}
