import { signal } from "@preact/signals";

/**
 * App-chrome UI intents: keymap / menu / Open board raise them, App renders.
 * Not Layout preset domain — lives here so Workspace / Session chrome do not
 * import through `presets/`.
 */
export type EditorRequest =
  | { readonly source: "board"; readonly workspace: string | null }
  | { readonly source: "live" };

export const boardOpen = signal(false);
export const saveDialogOpen = signal(false);
export const editorRequest = signal<EditorRequest | null>(null);
/**
 * Settings panel open state. Promoted from a local `useSignal` in `app.tsx`
 * to a module signal here so it sits alongside the other three overlays that
 * shadow the terminal grid — `tab-manager.ts`'s overlay scope guard (which
 * decides whether a shortcut/menu action may run while an overlay is up)
 * needs to read it, and only module-level signals are visible outside
 * `App`'s component closure.
 */
export const settingsOpen = signal(false);

/**
 * Token usage screen open state.
 *
 * The exact inverse of `promptsOpen` below, which says of itself:
 * "Deliberately NOT part of `openOverlayRanks()` (tab-manager.ts): this is a
 * pane-level popover anchored to a chrome button, not a surface that covers
 * the terminal grid." This one IS such a surface. `UsageScreen` is full-window
 * like `SettingsScreen`, so it MUST be pushed by `openOverlayRanks()`
 * (tab-manager.ts) or every pane-scoped shortcut stays live behind it — ⌘W
 * closing a pane nobody can see is the exact failure the tier model exists to
 * stop. It is also mutually exclusive with `settingsOpen`: opening either one
 * closes the other (spec §Surface, major M4).
 */
export const usageOpen = signal(false);

/**
 * Prompt Board popover open state.
 *
 * Deliberately NOT part of `openOverlayRanks()` (tab-manager.ts): this is a
 * pane-level popover anchored to a chrome button, not a surface that covers
 * the terminal grid, so it neither blocks other actions nor needs a tier. The
 * relationship runs the other way — the trigger is disabled and an open
 * popover closes while a real overlay is up, because the pane it targets is
 * then hidden.
 */
export const promptsOpen = signal(false);

/**
 * Most recent local-storage write failure, shown by PersistErrorBar.
 * Stores keep the in-memory signal as the source of truth even when the
 * disk write fails — this only tells the user a change may not survive
 * relaunch; it never blocks or reverts UI state.
 */
export const persistError = signal<string | null>(null);

/** Show a non-blocking, auto-dismissing message in the shared chrome bar. */
export function reportChromeMessage(message: string): void {
  persistError.value = message;
}

export function reportPersistError(message: string): void {
  reportChromeMessage(message);
}
