import { computed, signal } from "@preact/signals";

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
 * AgentQuickPicker open state — the `+` button's fast path (`newTab()` in
 * tab-manager.ts): pick an agent, open a single pane in the active tab's
 * workspace, no workspace/preset step. Same `.modal-scrim` genre as
 * PresetEditor/SavePresetDialog, so it shares their "modal" rank in
 * `openOverlayRanks()` rather than getting a tier of its own.
 */
export const agentQuickPickerOpen = signal(false);
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
 * Chrome surfaces that can each hold a tab rename/colour popover.
 *
 * `"sidebar"` is `WorkspaceSidebar`, still in the tree behind `RepositoryRail`
 * as its one-line revert (see app.tsx's import comment).
 */
export type TabPopoverOwner = "rail" | "strip" | "sidebar";

/**
 * The ONE surface whose tab popover is up, or `null`.
 *
 * A single slot, not a set: sidebar layout mounts the rail and the stage strip
 * together, and two options popovers floating over the same window at once is
 * not a state this app has any use for. Claiming the slot is therefore also
 * how a surface tells the others to close (`useTabPopoverSlot`).
 */
const popoverOwner = signal<TabPopoverOwner | null>(null);

/** Claim the slot. Any other surface holding it must close its own popover. */
export function openTabPopover(owner: TabPopoverOwner): void {
  popoverOwner.value = owner;
}

/**
 * Release the slot — **only if you still hold it.**
 *
 * The guard is the whole point and is not defensive padding. Every surface
 * used to write `flag = mine !== null` unconditionally, which is correct only
 * while exactly one of them is mounted; once two were, the one that closed
 * last spoke for both, and dismissing either popover said "nothing is open"
 * while the other still was. That un-hid the browser panel's native view over
 * a live popover — a native view wins over every DOM layer, no z-index
 * involved. An owner may only retract its own claim.
 */
export function closeTabPopover(owner: TabPopoverOwner): void {
  if (popoverOwner.value === owner) {
    popoverOwner.value = null;
  }
}

/** Who holds the slot — read by each surface to know when to stand down. */
export const tabPopoverOwner = computed(() => popoverOwner.value);

/**
 * Whether a tab's rename/colour popover is up at all.
 *
 * It exists for one consumer: the browser panel's native view paints above
 * every DOM layer, so a popover that overlaps the panel's column is invisible
 * unless the host is told to hide the view. Which tab it belongs to stays
 * component-local; this is the one bit anything outside has a reason to read.
 */
export const tabPopoverOpen = computed(() => popoverOwner.value !== null);

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
