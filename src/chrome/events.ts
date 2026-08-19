import { signal } from "@preact/signals";

/**
 * App-chrome UI intents: keymap / menu / Open board raise them, App renders.
 * Not Layout preset domain — lives here so Workspace / Session chrome do not
 * import through `presets/`.
 */
/**
 * One source since 2026-08-16: the board's `+ New Layout` card went with the
 * config view, so `new-preset` (⌘⇧N / menu) is the only way in. Kept as a
 * tagged union rather than collapsed to a bare signal — the tag is what
 * `handleEditorCreate` branches on, and a second source is the likely shape
 * of the next entry point.
 */
export type EditorRequest = { readonly source: "live" };

export const boardOpen = signal(false);
export const saveDialogOpen = signal(false);
export const editorRequest = signal<EditorRequest | null>(null);
/**
 * AgentQuickPicker open state — the `+` button's fast path (`newTab()` in
 * tab-manager.ts): pick an agent, open a single pane in the active tab's
 * workspace, no workspace/preset step. Same `.modal-scrim` genre as
 * PresetEditor/SavePresetDialog, so it shares their "modal" rank in
 * `openOverlayRanks()` rather than getting a tier of its own.
 */
export const agentQuickPickerOpen = signal(false);
/**
 * Which project the NEXT AgentQuickPicker open targets, or null for "wherever
 * the active tab is" — which is every open the `+`/⌘T path makes.
 *
 * Non-null only while the panel was raised from a rail project header
 * (DL-27.18), where the whole point of the click is that the destination is a
 * project other than the selected one. It lives beside `agentQuickPickerOpen`
 * rather than inside `App` for the same reason that signal does: `newTab()` in
 * tab-manager.ts is outside `App`'s closure and has to CLEAR it, so a rail
 * launch cannot leak into the next ⌘T.
 */
export const quickPickerWorkspace = signal<string | null>(null);
/**
 * Settings panel open state. Promoted from a local `useSignal` in `app.tsx`
 * to a module signal here so it is the one overlay signal that shadows the
 * terminal grid — `tab-manager.ts`'s overlay scope guard (which
 * decides whether a shortcut/menu action may run while an overlay is up)
 * needs to read it, and only module-level signals are visible outside
 * `App`'s component closure.
 */
export const settingsOpen = signal(false);

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
 * True while a Shortcuts row is listening for a replacement chord.
 *
 * `handleShortcut` (tab-manager.ts) is a CAPTURE-phase window listener that
 * runs before anything the settings screen could register, so a capture
 * control cannot out-listen it — pressing ⌘W to rebind it would close the pane
 * instead of being recorded. This flag is the seam that stops it, alongside
 * the existing `isChromeTextField` guard and for the same reason: while the
 * user is typing a chord AT the app, they are not typing a chord TO it.
 *
 * A module signal rather than a DOM check because the capture control holds
 * focus on a `<button>`, which `isChromeTextField` deliberately does not
 * match.
 */
export const shortcutCaptureActive = signal(false);

/**
 * A path an agent printed that the user just activated (design §3.2).
 *
 * The terminal's link provider raises this; `App` observes it, asks the main
 * process which open workspace contains the file, and either opens it in
 * Deck's own editor or hands it to the selected external app. It lives here,
 * beside the other chrome intents, for one structural reason: the link
 * provider MUST NOT import the file layer. `TabManager` knows nothing about
 * files, and the seam that keeps it that way runs through `App` — a direct
 * call from `link-provider.ts` into `file-surface-controller.ts` would tie a
 * terminal module to the file store and make that seam unobservable.
 *
 * One-shot: `App` clears it as soon as it has read it, so re-activating the
 * same path raises a NEW request rather than being swallowed as "unchanged".
 * The counter is what makes that true for two clicks on one path.
 */
export interface PathOpenRequest {
  /** Absolute, already canonicalised by `resolve_paths`. */
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
  /** Distinguishes two activations of the same path. */
  readonly nonce: number;
}

export const pathOpenRequest = signal<PathOpenRequest | null>(null);

let pathOpenNonce = 0;

export function requestPathOpen(request: Omit<PathOpenRequest, "nonce">): void {
  pathOpenNonce += 1;
  pathOpenRequest.value = { ...request, nonce: pathOpenNonce };
}

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
