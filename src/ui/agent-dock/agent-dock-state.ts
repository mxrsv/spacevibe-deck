/**
 * Window-scoped state of the tabbed dock (R5): which view the body shows, and whether the
 * narrow-window sheet is open. Module-level so the choice survives focus moving between agents, and
 * so `App` can read the sheet flag for `browserPanelObscured`.
 */
import { signal } from "@preact/signals";
import type { DockTab } from "../../settings/settings-schema";

export type DockViewId = "changes" | "usage" | "files" | "history";

/** The strip's fixed order (DOCK-1). */
export const DOCK_VIEWS: readonly DockViewId[] = ["changes", "usage", "files", "history"];

/** What a fresh window shows: the checkout's Changes, the thing an agent's work leaves behind. */
const DEFAULT_VIEW: DockViewId = "changes";

/** The view each legacy dock tab (and its chord) names. */
export const VIEW_OF_TAB: Readonly<Record<DockTab, DockViewId>> = {
  explorer: "files",
  usage: "usage",
  sessions: "history",
};

/** The view the user chose; `DockColumn` falls back from it when it is unavailable. */
export const dockView = signal<DockViewId>(DEFAULT_VIEW);

export function setDockView(view: DockViewId): void {
  dockView.value = view;
}

/**
 * The narrow-window sheet. The native browser view paints above every DOM layer, so `App` yields
 * it while this is true; the host resets it when it unmounts or the window widens.
 */
export const dockSheetOpen = signal(false);

let afterSheetClose: (() => void) | null = null;

/**
 * Close the sheet and run `action` once it has let go of focus. The sheet returns focus to its
 * handle when it closes; an action that wants focus elsewhere (the diff column a file press just
 * opened) cannot win that race by running first, so `DockEdge` runs it in place of the return.
 */
export function closeDockSheetThen(action: () => void): void {
  afterSheetClose = action;
  dockSheetOpen.value = false;
}

/** The action `closeDockSheetThen` left for the sheet's close, once; null for any other close. */
export function takeAfterSheetClose(): (() => void) | null {
  const action = afterSheetClose;
  afterSheetClose = null;
  return action;
}

export function resetAgentDockState(): void {
  afterSheetClose = null;
  dockView.value = DEFAULT_VIEW;
  dockSheetOpen.value = false;
}
