/**
 * Where the stacked dock sits and how wide it is (spec LAY-9, OD-4).
 *
 * The column rests at 320px and resizes by the same grip as the tabbed dock (`DockResizeGrip`).
 * Under 1360px of window width it shrinks to a 32px edge handle, and opening it draws the same
 * column in a sheet over the stage. The window width is read through one signal, and `App` reads
 * only the boolean derived from it, so a window drag re-renders `App` when the width crosses the
 * threshold and not on every pixel.
 */
import { computed, signal } from "@preact/signals";
import { isReleaseSwitchEnabled } from "../../lib/release-switches";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { rendererReleaseSwitches } from "../../terminal/action-availability";

export const AGENT_DOCK_WIDTH = 320;
export const AGENT_DOCK_EDGE_WIDTH = 32;
export const AGENT_DOCK_NARROW_BELOW = 1360;

/** Read at render time, never into a constant (release-switch convention). */
export function agentDockEnabled(): boolean {
  return isReleaseSwitchEnabled("agentDock", rendererReleaseSwitches());
}

const windowWidth = signal(typeof window === "undefined" ? 0 : window.innerWidth);
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    windowWidth.value = window.innerWidth;
  });
}

/** Whether the window is too narrow for the column, so the dock is an edge handle. */
export const dockNarrow = computed(() => windowWidth.value < AGENT_DOCK_NARROW_BELOW);

/**
 * The width the stage and the diff column leave for the dock (`--dock-w`). With the switch off it
 * is the live drag width, else the stored one, untouched. With it on, the column rests at 320px
 * while the stored width is still the legacy default (420, which nobody chose); a width the user
 * dragged to is honoured. The live width wins during a drag, so the column follows the pointer.
 */
export function dockStageWidth(storedWidth: number, liveWidth: number | null = null): number {
  if (!agentDockEnabled()) {
    return liveWidth ?? storedWidth;
  }
  if (dockNarrow.value) {
    return AGENT_DOCK_EDGE_WIDTH;
  }
  if (liveWidth !== null) {
    return liveWidth;
  }
  return storedWidth === DEFAULT_SETTINGS.dockWidth ? AGENT_DOCK_WIDTH : storedWidth;
}
