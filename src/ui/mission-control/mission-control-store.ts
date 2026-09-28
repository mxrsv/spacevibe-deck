import { signal } from "@preact/signals";

/**
 * Mission Control's window-scoped state (DL-35.1, R5). Transient on purpose:
 * it is a way of LOOKING at the window's tabs, so it owns nothing, is never
 * journaled, and a relaunch opens on the terminal.
 *
 * `missionControlOpen` is read by `TabManager.openOverlayRanks`, which is why
 * it is a store signal rather than `App`-local state: the chord guard and the
 * screen must answer from one value.
 */
export const missionControlOpen = signal(false);

/** Close without animation — a tab switch or a closing tab outruns the zoom. */
export function dismissMissionControl(): void {
  missionControlOpen.value = false;
}
