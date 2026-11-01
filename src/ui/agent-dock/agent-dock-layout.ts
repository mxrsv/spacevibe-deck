/**
 * Where the stacked dock sits and how wide it is (spec LAY-9, OD-4).
 *
 * The column is a fixed 320px with no resize grip. Under 1360px of window width it shrinks to a
 * 32px edge handle, and opening it draws the same column in a sheet over the stage. The window
 * width is read through one signal, and `App` reads only the boolean derived from it, so a window
 * drag re-renders `App` when the width crosses the threshold and not on every pixel.
 */
import { computed, signal } from "@preact/signals";
import { isReleaseSwitchEnabled } from "../../lib/release-switches";
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
 * is the stored width, untouched; with it on the stored `dockWidth` is ignored, not rewritten.
 */
export function dockStageWidth(storedWidth: number): number {
  if (!agentDockEnabled()) {
    return storedWidth;
  }
  return dockNarrow.value ? AGENT_DOCK_EDGE_WIDTH : AGENT_DOCK_WIDTH;
}
