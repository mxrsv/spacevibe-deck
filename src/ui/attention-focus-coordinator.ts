/**
 * Pure, synchronous preflight shared by the `Cmd+Shift+A` shortcut and the
 * status-mark click (Task 14B). Both entry points must run the exact same
 * overlay-handling logic before any pane is actually focused, so that:
 *  - a `PresetEditor`/`SavePresetDialog` draft is never silently discarded,
 *  - `OpenBoard`/Settings are dismissed via non-focusing set-state (never via
 *    `OpenBoard.onCancel`/`closePanel()`, which focus the active pane and
 *    could acknowledge an intermediate/wrong pane before the real candidate
 *    is chosen).
 *
 * This module has no dependency on Preact, the DOM, or any async APIs — it
 * is a plain function operating on caller-supplied closures.
 */

/** Snapshot of every overlay that can shadow the terminal grid. */
export interface AttentionOverlaySnapshot {
  /** Open board open. */
  board: boolean;
  /** Settings panel open. */
  settings: boolean;
  /** PresetEditor open (holds a draft). */
  presetEditor: boolean;
  /** SavePresetDialog open (holds a draft). */
  savePresetDialog: boolean;
}

/** Input to {@link runAttentionFocus}. */
export interface AttentionFocusRequest {
  /** `undefined` = global (shortcut); a number = scoped (status click). */
  tabIndex?: number;
  /** Precomputed by the caller, e.g. `tabsRef.hasActionableAttention(tabIndex)`. */
  hasCandidate: boolean;
  /** Current overlay state. */
  overlays: AttentionOverlaySnapshot;
  /**
   * NON-focusing set-state (e.g. `boardOpen.value = false`) — NOT
   * `OpenBoard.onCancel`, which focuses the active pane.
   */
  dismissBoard: () => void;
  /**
   * NON-focusing set-state (e.g. `settingsOpen.value = false`) — NOT
   * `closePanel()`, which focuses the active pane.
   */
  dismissSettings: () => void;
  /**
   * e.g. `tabsRef.focusNextAttention(tabIndex)`; it re-validates the
   * candidate itself.
   */
  focusAttention: (tabIndex?: number) => void;
}

/**
 * Runs the fixed, synchronous overlay preflight shared by the attention
 * shortcut and the status-mark click:
 *
 * 1. No candidate → complete no-op (no dismiss, no focus).
 * 2. `presetEditor` or `savePresetDialog` open → BLOCKED: complete no-op,
 *    every overlay (including board/settings) stays open and every draft
 *    stays intact.
 * 3. Otherwise: dismiss `board`/`settings` (only the ones
 *    that are open), then call `focusAttention`.
 *
 * There is no `await` anywhere in this function — dismissal and focus run
 * back-to-back in the same synchronous tick.
 */
export function runAttentionFocus(req: AttentionFocusRequest): void {
  const {
    tabIndex,
    hasCandidate,
    overlays,
    dismissBoard,
    dismissSettings,
    focusAttention,
  } = req;

  if (!hasCandidate) {
    return; // nothing to focus — leave every overlay exactly as-is
  }

  if (overlays.presetEditor || overlays.savePresetDialog) {
    return; // draft in flight — blocked, no dismissal, no focus
  }

  if (overlays.board) {
    dismissBoard();
  }
  if (overlays.settings) {
    dismissSettings();
  }
  focusAttention(tabIndex);
}
