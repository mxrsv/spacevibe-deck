import type { Settings } from "../settings/settings-schema";
import type { Direction, Edge, SerializedNode } from "../lib/split-tree";
import type { FocusDirection, PaneRect } from "../lib/pane-geometry";
import type { PaneProcessInfo } from "../lib/process-info";
import type { CreatePaneFn } from "./pane-lifecycle";
import type { PaneAttentionSignal } from "./pane";
import type { DetachTarget, PaneIdentity } from "./pane-detach";
import type { AdoptResult } from "./pane-adopt";
import type { TransferClient } from "./transfer-client";

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
export const TRANSFER_FALLBACK_COLS = 80;
export const TRANSFER_FALLBACK_ROWS = 24;

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
  /**
   * Dock a freshly spawned pane on one edge of `targetPaneId` and return its
   * id, or `null` when nothing was created (unknown/closed target, spawn
   * failure). The new pane starts in the target's LIVE cwd, the same fresh
   * lookup `splitActive` makes, and is left focused.
   *
   * Separate from `splitActive` because a drop names both the pane and the
   * side, where a split only ever acts on the active pane in a direction. The
   * caller decides what — if anything — the pane then runs: the returned id is
   * what `TabManager` arms an agent command against.
   */
  dockNewPaneAt(targetPaneId: number, edge: Edge): Promise<number | null>;
  /** Live slot geometry, for a drag hit-testing panes from outside the stage. */
  slotRects(): readonly PaneRect[];
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
