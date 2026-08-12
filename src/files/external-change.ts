/**
 * What happens when the agent writes the file underneath you (plan T8,
 * spec §5).
 *
 * This is the common case in Deck, not an edge case: the loop the user is in is
 * "ask an agent to change something, then read what it changed".
 *
 * | Tab state | On disk | Behavior                                          |
 * | --------- | ------- | ------------------------------------------------- |
 * | clean     | changed | reload silently, holding scroll and cursor        |
 * | clean     | deleted | mark gone, keep the content, read-only            |
 * | dirty     | changed | bar: Reload / Keep mine — never auto-decide       |
 * | dirty     | deleted | bar: Save again / Close                           |
 *
 * Plus the two rows the table implies and does not draw: an event for a file
 * that is not open is dropped, and a duplicate event carrying an unchanged
 * mtime is a no-op. `fs.watch` fires twice on macOS routinely, and a second
 * silent reload would throw away the cursor position the first one preserved.
 */

export type ChangeKind = "changed" | "deleted";

export interface ChangeEvent {
  readonly path: string;
  readonly kind: ChangeKind;
  /** Modification time in ms, or null when the file is gone. */
  readonly mtimeMs: number | null;
  /** Size in bytes, or null when the file is gone. */
  readonly size: number | null;
}

/** What the decision needs to know about the open tab. */
export interface OpenFileState {
  readonly dirty: boolean;
  /** Already marked as deleted by an earlier event. */
  readonly gone: boolean;
  /** mtime as of the last read or save; null when it was never on disk. */
  readonly mtimeMs: number | null;
  /** Size as of the last read or save. Guards mtime-granularity collisions. */
  readonly size: number | null;
  /** A bar is already up for this tab, awaiting the user's answer. */
  readonly prompting: boolean;
}

export type ChangeAction =
  /** Nothing to do: not open, unchanged, or already answered. */
  | { readonly kind: "none" }
  /** Clean + changed: re-read and swap the content, holding scroll and cursor. */
  | { readonly kind: "reload" }
  /** Clean + deleted: keep the last content on screen, read-only. */
  | { readonly kind: "mark-gone" }
  /** Dirty + changed: Reload (discard mine) / Keep mine. */
  | { readonly kind: "prompt-changed" }
  /** Dirty + deleted: Save again / Close. */
  | { readonly kind: "prompt-deleted" };

/**
 * The whole table, as one function.
 *
 * `state === undefined` means the file is not open — the watcher's scope is the
 * open tabs plus the expanded directories, so directory events routinely name
 * files nothing is showing.
 */
export function decideExternalChange(
  event: ChangeEvent,
  state: OpenFileState | undefined,
): ChangeAction {
  if (state === undefined) {
    return { kind: "none" };
  }
  if (state.prompting) {
    // A bar is already up. Replacing it would move the buttons under a
    // pointer that is on its way to one of them, and the user's answer still
    // applies: whichever content they choose is re-checked when it lands.
    return { kind: "none" };
  }
  if (event.kind === "deleted") {
    if (state.gone) {
      return { kind: "none" };
    }
    return state.dirty ? { kind: "prompt-deleted" } : { kind: "mark-gone" };
  }
  // A file that came back is a change, even if its mtime matches what we last
  // saw — checking `gone` first is what makes "deleted then rewritten" reload
  // instead of staying stuck on the gone banner.
  if (
    !state.gone &&
    state.mtimeMs !== null &&
    event.mtimeMs === state.mtimeMs &&
    event.size === state.size
  ) {
    return { kind: "none" };
  }
  return state.dirty ? { kind: "prompt-changed" } : { kind: "reload" };
}

/** The bar's two choices, per row of the table. */
export type ChangeResolution =
  | "reload"
  | "keep-mine"
  | "save-again"
  | "close";

/** Whether a resolution belongs to the bar the state is showing — a stale
 * click (the bar changed kind between render and click) is refused rather
 * than applied to the wrong row. */
export function resolutionApplies(
  action: ChangeAction["kind"],
  resolution: ChangeResolution,
): boolean {
  if (action === "prompt-changed") {
    return resolution === "reload" || resolution === "keep-mine";
  }
  if (action === "prompt-deleted") {
    return resolution === "save-again" || resolution === "close";
  }
  return false;
}
