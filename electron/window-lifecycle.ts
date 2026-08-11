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

/** How a window should come up. A window opened to receive a transferred pane
 * boots into adoption instead of restoring a session. */
export type BootMode =
  | { readonly mode: "restore" }
  | { readonly mode: "adopt"; readonly token: string };

export class WindowRegistry {
  /** Most-recently-focused first; the move-pane submenu is ordered by it. */
  private focusOrder: string[] = [];
  private readonly pendingAdoptions = new Map<string, string>();
  private nextIndex = 1;

  /** Allocate the next never-before-used label. */
  allocateLabel(): string {
    this.nextIndex += 1;
    return `deck-${this.nextIndex}`;
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
      return { mode: "restore" };
    }
    this.pendingAdoptions.delete(label);
    return { mode: "adopt", token };
  }
}
