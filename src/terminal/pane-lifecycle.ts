import type { Settings } from "../settings/settings-schema";
import { reportPersistError } from "../chrome/events";
import { leaf, leafIds, replaceLeaf, type TreeNode } from "../lib/split-tree";
import {
  createPane,
  type Pane,
  type PaneAttentionSignal,
  type PaneEvents,
} from "./pane";
import { clearPaneCwd, setPaneCwd } from "./pane-cwd";
import type { PtyClient } from "./pty-client";

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
      try {
        await deps.pty.writePty(id, data);
        return true;
      } catch {
        reportPersistError(
          "Couldn't send input to the terminal — the session may have ended.",
        );
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
    killPane,
    killAll,
    isInTree,
    respawn,
    openInitial,
    paneEvents,
    enqueueWrite,
  };
}
