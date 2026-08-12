/**
 * The renderer's door onto the native menu.
 *
 * Only one thing to say so far: stop the menu eating chords while a Shortcuts
 * row is recording one. Everything else about the menu is derived in the main
 * process from `ACTION_REGISTRY`, which is why there is nothing else here.
 */
import { invoke } from "./bridge";

/**
 * Ask the host to install the menu with, or without, its accelerators.
 *
 * Failure is swallowed on purpose. This is a courtesy to the capture UI, not a
 * correctness requirement of it: on a platform with no native menu (Windows,
 * or the browser-only dev preview where the bridge does not exist at all)
 * there is nothing to suspend, and a rejected promise here would turn a
 * working capture into a visible error for no user-facing reason.
 */
export async function suspendMenuAccelerators(
  suspended: boolean,
): Promise<void> {
  try {
    await invoke("suspend_menu_accelerators", { suspended });
  } catch {
    // No host bridge, or a host with no menu. Capture still works.
  }
}
