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

/** A Changes card's key in `dockFoldedCards`: NUL cannot sit in a path, so no two roots collide. */
export const cardKey = (root: string, path: string): string => `${root}\0${path}`;

/** `cardKey`s of the Changes cards the user folded; window-scoped so a view switch keeps them. */
export const dockFoldedCards = signal<ReadonlySet<string>>(new Set());

export function toggleDockCardFold(key: string): void {
  const next = new Set(dockFoldedCards.value);
  if (!next.delete(key)) {
    next.add(key);
  }
  dockFoldedCards.value = next;
}

/** Unfold one card; an unfolded card writes nothing, so the stack does not render again. */
export function unfoldDockCard(key: string): void {
  if (dockFoldedCards.value.has(key)) {
    const next = new Set(dockFoldedCards.value);
    next.delete(key);
    dockFoldedCards.value = next;
  }
}

/**
 * Forget the folds of `root`'s cards whose file left the list, so a file that comes back starts
 * unfolded. Other roots' folds stay: this read says nothing about them.
 */
export function pruneDockFoldedCards(root: string, paths: readonly string[]): void {
  const prefix = cardKey(root, "");
  const live = new Set(paths.map((path) => cardKey(root, path)));
  const kept = [...dockFoldedCards.value].filter((key) => !key.startsWith(prefix) || live.has(key));
  if (kept.length !== dockFoldedCards.value.size) {
    dockFoldedCards.value = new Set(kept);
  }
}

export function resetAgentDockState(): void {
  dockView.value = DEFAULT_VIEW;
  dockSurface.value = "view";
  dockTreePane.value = null;
  dockChangesList.value = false;
  dockFoldedCards.value = new Set();
  dockWideRequested.value = false;
}
