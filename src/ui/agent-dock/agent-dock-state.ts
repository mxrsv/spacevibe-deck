/**
 * Window-scoped state of the tabbed dock (R5): which view the body shows, and whether the
 * narrow-window sheet is open. Module-level so the choice survives focus moving between agents, and
 * so `App` can read the sheet flag for `browserPanelObscured`.
 */
import { signal } from "@preact/signals";
import type { DockTab } from "../../settings/settings-schema";
import { dockWideRequested } from "./agent-dock-layout";

export type DockViewId = "changes" | "usage" | "history";

/** The strip's fixed order (DOCK-1). Documents are tabs after these (DOCK-6), not a view. */
export const DOCK_VIEWS: readonly DockViewId[] = ["changes", "usage", "history"];

/**
 * What the body shows: a fixed view, the active file tab, or the Explorer tab (`+`). Kept apart
 * from `dockView` so choosing a file never forgets which view the user left, and so a fixed icon
 * can take the body without closing any file tab (the file surface store keeps those).
 */
export type DockSurface = "view" | "file" | "explorer";

/** What a fresh window shows: the checkout's Changes, the thing an agent's work leaves behind. */
const DEFAULT_VIEW: DockViewId = "changes";

/** The view each legacy dock tab (and its chord) names; the explorer is a surface, not a view. */
export const VIEW_OF_TAB: Readonly<Record<Exclude<DockTab, "explorer">, DockViewId>> = {
  usage: "usage",
  sessions: "history",
};

/** The view the user chose; `DockColumn` falls back from it when it is unavailable. */
export const dockView = signal<DockViewId>(DEFAULT_VIEW);

export const dockSurface = signal<DockSurface>("view");

export function setDockView(view: DockViewId): void {
  dockView.value = view;
  dockSurface.value = "view";
}

/** The `+` tab: the project tree at full width. */
export function selectDockExplorer(): void {
  dockSurface.value = "explorer";
}

/** The active file tab takes the body. Also the Explorer tab's way out when a file opens. */
export function selectDockFile(): void {
  dockSurface.value = "file";
}

/**
 * The user's own choice for the tree pane beside a file, or null to follow the dock's width
 * (hidden under 560px, DOCK-6). Window-scoped so it holds while the file body remounts.
 */
export const dockTreePane = signal<boolean | null>(null);

/** The Changes view's own list pane beside the card stack (DOCK-10); off until the user asks. */
export const dockChangesList = signal(false);

/** `root\0path` of the Changes cards the user folded; window-scoped so a view switch keeps them. */
export const dockFoldedCards = signal<ReadonlySet<string>>(new Set());

export function toggleDockCardFold(key: string): void {
  const next = new Set(dockFoldedCards.value);
  if (!next.delete(key)) {
    next.add(key);
  }
  dockFoldedCards.value = next;
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
  dockWideRequested.value = false;
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
  dockSurface.value = "view";
  dockTreePane.value = null;
  dockChangesList.value = false;
  dockFoldedCards.value = new Set();
  dockSheetOpen.value = false;
  dockWideRequested.value = false;
}
