import { editorRequest, saveDialogOpen, settingsOpen } from '../chrome/events';
import type { BootMode } from '../terminal/transfer-client';

interface BrowserPanelObscuredState {
  readonly overlayCoversPane: boolean;
  readonly agentQuickPickerOpen: boolean;
  readonly promptsOpen: boolean;
  readonly persistErrorVisible: boolean;
  readonly settingsLoadError: boolean;
}

/** Native browser views must hide whenever DOM chrome paints over the stage. */
export function browserPanelObscured(state: BrowserPanelObscuredState): boolean {
  return (
    state.overlayCoversPane ||
    state.agentQuickPickerOpen ||
    state.promptsOpen ||
    state.persistErrorVisible ||
    state.settingsLoadError
  );
}

/**
 * Pure Settings-close: sets `settingsOpen` false and hands focus back.
 * Extracted to module scope (out of `App()`'s closure) so it and
 * `toggleSettingsPanel` below can be unit-tested directly — this repo has no
 * `<App>`-level render harness, and building one just for this guard would
 * be disproportionate. `App()`'s `closePanel` supplies the real
 * `tabsRef.current?.focusActive()` as `focusActive`.
 */
export function closeSettingsPanel(focusActive: () => void): void {
  settingsOpen.value = false;
  focusActive();
}

/**
 * Settings toggle — shared by the gear button and `⌘,`/the menu's
 * "Settings…" item (both call `App()`'s `toggleSettings` closure below,
 * the literal same function reference, so this guard covers both entry
 * points at once).
 *
 * CLOSING (the `if` branch) stays unconditional — Settings must always be
 * reachable to close, or it could strand itself open forever, the exact
 * trap `b7e6021` already had to design around for the overlay scope guard.
 *
 * OPENING (the `else` branch) is blocked only while a PresetEditor/
 * SavePresetDialog draft is up. A draft's modal-scrim sits at z-index 40,
 * above Settings' 35 (styles.css) — opening Settings underneath one would be
 * invisible and unreachable, while `SettingsScreen`'s mount-focus effect
 * (settings/settings-screen.tsx) still stole DOM focus from the draft, so a
 * later Escape closed the invisible Settings and orphaned focus behind a
 * surface that never moved. Same check `runAttentionFocus` makes for
 * Cmd+Shift+A (attention-focus-coordinator.ts:80-82).
 *
 * The Open board is deliberately NOT in that list any more. F3 (2026-07-27
 * code review) added it because Settings was then a 300px drawer at z-20,
 * genuinely hidden beneath the z-30 board. Settings is now a full-window
 * surface at z-35: it covers the board rather than hiding under it, so it
 * opens from the board like from anywhere else, and closing returns to the
 * board with its selection intact. Blocking it there left the gear button
 * silently inert, which reads as a broken app rather than a deliberate rule.
 *
 * Settings is the only full-window surface left since 2026-08-16: token usage
 * and session history became tabs of the dock, which displaces the terminal
 * grid instead of covering it. The mutual exclusion those three used to keep
 * (spec §Surface, major M4) went with them — a docked column and a
 * full-window screen do not compete for the same layer.
 */
export function toggleSettingsPanel(focusActive: () => void): void {
  if (settingsOpen.value) {
    closeSettingsPanel(focusActive);
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return;
  }
  settingsOpen.value = true;
}

interface StripSurfaceState {
  readonly boardOpen: boolean;
  readonly settingsOpen: boolean;
}

/**
 * Whether the stage strip carries its tab chips (sidebar layout only).
 *
 * The strip is not just chips: in sidebar mode it IS the frame row's stage-side
 * half (DL-18.6), and while the sidebar is hidden it is the whole frame row —
 * traffic-light inset, the sidebar's way back out (DL-18.9), the feature
 * toolbar and the dock's control. Those stay put over a full-window surface,
 * which is the point of the fix that put one below the strip instead of over
 * it. The CHIPS do not: the Open board and the Settings screen replace what the
 * tabs show, so a row of them over one lists things that are not on screen.
 *
 * Only the two full-window surfaces count. A modal (PresetEditor,
 * SavePresetDialog, AgentQuickPicker) floats on a scrim with the strip legible
 * underneath — its chips are still the truth about what is open.
 *
 * Module scope, like the guards above, purely so it is unit-testable: this repo
 * has no `<App>`-level render harness.
 */
export function stripShowsTabs(state: StripSurfaceState): boolean {
  return !state.boardOpen && !state.settingsOpen;
}

/**
 * Whether a preset created through the LIVE-WINDOW flow (⌘⇧N, or File ▸ "New
 * Layout Preset…") should also materialize a tab, or stop once the preset is
 * saved.
 *
 * `new-preset` is tiered `"modal"` in action-registry.ts, so it deliberately
 * opens the editor OVER the Open board (rank 30 < 40) — sketching a layout
 * from scratch needs no tab and no workspace, which is the whole point of F4.
 * What must NOT follow is the live-window tail that materializes a tab: the
 * board is still up at z-30 covering the stage, so that tab would be
 * invisible while its pane quietly takes DOM focus behind the board, and on
 * the app's default landing screen (no tabs yet) there is no active pane to
 * inherit a CWD from either — it would spawn in `$HOME` instead of the folder
 * selected on the board.
 *
 * Stopping at the save leaves the preset available and the board up, and the
 * user opens a folder with it — which since 2026-08-16 means the preset is
 * picked up by the next open of a workspace that remembers it, the board
 * itself having no layout picker any more. Extracted to module scope (like
 * `toggleSettingsPanel` above) purely so it is unit testable — this repo has
 * no `<App>`-level render harness.
 */
export function livePresetOpensATab(boardIsOpen: boolean): boolean {
  return !boardIsOpen;
}

/**
 * A window that booted to adopt a pane already has its content: showing the
 * Open board would cover a live terminal with a "pick a folder" screen
 * (spec §9.2). Extracted to module scope for the same reason as
 * `livePresetOpensATab` above — this repo has no `<App>` render harness.
 */
export function bootOpensTheBoard(boot: BootMode): boolean {
  return boot.kind === 'normal';
}

/**
 * The workspace `tabs[closingIndex]` belongs to, when closing that tab
 * leaves it with no terminal tab left in THIS window while at least one
 * other terminal tab (of a DIFFERENT workspace) still exists — the case
 * where that workspace's file tabs would otherwise go unreachable behind a
 * live tab of another workspace, yet stay open, watched and dirty-blocking
 * quit. Null when there is nothing to close (no workspace, or another tab of
 * the same workspace survives).
 *
 * Deliberately returns null when `remaining.length === 0` — the window's
 * LAST terminal tab closing is `TabManager`'s "last surface, not last tab"
 * territory (spec §7): `disposeTab` already keeps the window alive on that
 * workspace's own file surface via `SurfaceStrip.total()`, and closing those
 * same file tabs here would defeat the rule that just kept them reachable.
 *
 * Extracted to module scope (like `livePresetOpensATab`/`bootOpensTheBoard`
 * above) so it is unit-testable without an `<App>` render harness, which
 * this repo does not have.
 */
export function workspaceOrphanedByClose(
  tabs: readonly { readonly workspacePath: string | null }[],
  closingIndex: number,
): string | null {
  const workspacePath = tabs[closingIndex]?.workspacePath ?? null;
  if (workspacePath === null) {
    return null;
  }
  const remaining = tabs.filter((_, index) => index !== closingIndex);
  if (remaining.length === 0) {
    return null;
  }
  return remaining.some((tab) => tab.workspacePath === workspacePath) ? null : workspacePath;
}
