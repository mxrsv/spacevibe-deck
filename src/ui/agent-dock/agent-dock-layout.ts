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

/** The width the strip's maximize control gives the dock (the owner-approved mock is 700px). */
export const AGENT_DOCK_WIDE = 700;
/** What the window must keep for the sidebar and a usable stage beside a wide dock. */
export const AGENT_DOCK_STAGE_RESERVE = 760;

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
  if (dockMaximized.value) {
    return AGENT_DOCK_WIDE;
  }
  return storedWidth === DEFAULT_SETTINGS.dockWidth ? AGENT_DOCK_WIDTH : storedWidth;
}

/** Whether the window can give the dock `AGENT_DOCK_WIDE` and still leave the stage its reserve. */
export const dockWideAffordable = computed(
  () => windowWidth.value - AGENT_DOCK_WIDE >= AGENT_DOCK_STAGE_RESERVE,
);

/**
 * The strip's maximize control (window-scoped, R5, never written to settings). It is a request,
 * not a width: the stored width stays under it, so clearing it is the restore. It is not carried
 * by `dockWidthLive`, because a live width reads as a drag in flight and would keep a dock the
 * user hides painted open (`dockPaintedOpen`). A grip drag clears it, as the new width is theirs.
 */
export const dockWideRequested = signal(false);

/** Whether the dock is painted wide right now: asked for, and the window still affords it. */
export const dockMaximized = computed(
  () => dockWideRequested.value && dockWideAffordable.value && !dockNarrow.value,
);

export function toggleDockMaximized(): void {
  dockWideRequested.value = !dockMaximized.value;
}
