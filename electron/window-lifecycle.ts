/**
 * Window labels, focus order and boot mode — the port of
 * `src-tauri/src/window_lifecycle.rs`.
 *
 * Labels are `main` and then `deck-<n>`, allocated monotonically and NEVER
 * reused within a process run. That is load-bearing rather than tidy: the
 * coordinator remembers dead labels to decide whether a pane may be handed
 * back, and a reused label would resurrect a window that no longer exists.
 */

export const MAIN_LABEL = "main";

/**
 * How a window should come up.
 *
 * The key is `kind` and the idle value is `"normal"` because that is the wire
 * shape Rust produced (`#[serde(tag = "kind", rename_all = "lowercase")]`) and
 * `bootModeOrNormal` in the renderer reads exactly that. Emitting
 * `{ mode: "restore" }` instead made every detached window fall through to
 * "normal", so it booted to the Open Board and the pane stayed stranded at the
 * source until the transfer timed out.
 */
export type BootMode =
  { readonly kind: "normal" } | { readonly kind: "adopt"; readonly token: string };

export class WindowRegistry {
  /** Most-recently-focused first; the move-pane submenu is ordered by it. */
  private focusOrder: string[] = [];
  private readonly pendingAdoptions = new Map<string, string>();
  private nextIndex = 1;

  /** Allocate the next never-before-used label. */
  allocateLabel(): string {
    // Post-increment: the first detached window is `deck-1`, matching Rust's
    // `fetch_add` which returns the pre-value. The label is menu item text, so
    // starting at `deck-2` was visible to the user.
    const index = this.nextIndex;
    this.nextIndex += 1;
    return `deck-${index}`;
  }

  recordFocus(label: string): void {
    this.focusOrder = [label, ...this.focusOrder.filter((l) => l !== label)];
  }

  forgetWindow(label: string): void {
    this.focusOrder = this.focusOrder.filter((l) => l !== label);
    this.pendingAdoptions.delete(label);
  }

  /** Labels most-recently-focused first, excluding `exclude`. */
  order(exclude?: string): string[] {
    return this.focusOrder.filter((label) => label !== exclude);
  }

  /** Register that a window is being opened to adopt `token`. */
  reserveAdoption(label: string, token: string): void {
    this.pendingAdoptions.set(label, token);
  }

  /**
   * How this window should boot. Consumed once: a reload must not re-adopt a
   * pane that has already been taken.
   */
  bootMode(label: string): BootMode {
    const token = this.pendingAdoptions.get(label);
    if (token === undefined) {
      return { kind: "normal" };
    }
    this.pendingAdoptions.delete(label);
    return { kind: "adopt", token };
  }
}
