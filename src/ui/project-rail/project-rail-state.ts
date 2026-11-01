/**
 * The project-first rail's window state (R5: signals, window-scoped). Session-only by
 * owner decision F2 (`rail-view-state.ts`): no settings key, no journal, no IPC.
 *
 * Three pieces: the `RailViewState` the view model reads, the set of folded projects (a
 * fold is the rail's own, so `RailViewState` carries no field for it), and the coarse
 * clock the rows' time-in-state reads.
 */
import { signal } from "@preact/signals";
import { forgetRailFocus } from "./project-rail-focus";
import {
  INITIAL_RAIL_VIEW_STATE,
  setArchived,
  setProjectHidden,
  togglePinned,
  type RailGrouping,
  type RailSorting,
  type RailViewState,
} from "../rail-view-state";

export const railViewState = signal<RailViewState>(INITIAL_RAIL_VIEW_STATE);

/** The search, Organize and sort fields are plain data on `RailViewState`; one new object per change. */
export function setRailQuery(query: string): void {
  railViewState.value = { ...railViewState.value, query };
}

export function setRailGrouping(grouping: RailGrouping): void {
  railViewState.value = { ...railViewState.value, grouping };
}

export function setRailSorting(sorting: RailSorting): void {
  railViewState.value = { ...railViewState.value, sorting };
}

/**
 * Organize's "Show archived" and the Archived section's head are one switch: the section's open
 * state. The section is there whenever a row is archived and starts folded, as the mock has it.
 */
export const showArchived = signal(false);

/** The Hidden section's open state. */
export const hiddenOpen = signal(false);

export function togglePin(id: string): void {
  railViewState.value = togglePinned(railViewState.value, id);
}

/** An archived row leaves its project and waits in the Archived section. */
export function archiveItem(id: string): void {
  railViewState.value = setArchived(railViewState.value, id, true);
}

export function unarchiveItem(id: string): void {
  railViewState.value = setArchived(railViewState.value, id, false);
}

/** A hidden project leaves the list and waits in the Hidden section. */
export function setRailProjectHidden(key: string, hidden: boolean): void {
  railViewState.value = setProjectHidden(railViewState.value, key, hidden);
}

/** `RailGroup.key`s. A new Set per change (C1), so the signal notifies. */
export const foldedProjects = signal<ReadonlySet<string>>(new Set());

export function toggleProjectFolded(key: string): void {
  const next = new Set(foldedProjects.value);
  if (!next.delete(key)) {
    next.add(key);
  }
  foldedProjects.value = next;
}

/** Bring a project's rows back: the pill's jump lands on a row a fold would hide. */
export function unfoldProject(key: string): void {
  if (!foldedProjects.value.has(key)) {
    return;
  }
  const next = new Set(foldedProjects.value);
  next.delete(key);
  foldedProjects.value = next;
}

/** The label reads "5m", so a minute is the finest step worth waking a row for. */
const CLOCK_TICK_MS = 60_000;

/** Only the rows' time label reads it; the rail's view is never rebuilt on a tick. */
export const railNow = signal(Date.now());

/**
 * Keeps `railNow` moving while the rail is mounted. It stands still while the window is
 * hidden (U5: nothing repaints while idle) and catches up the moment it shows again.
 * Returns the stop function.
 */
export function runRailClock(): () => void {
  const tick = (): void => {
    if (!document.hidden) {
      railNow.value = Date.now();
    }
  };
  tick();
  const timer = window.setInterval(tick, CLOCK_TICK_MS);
  document.addEventListener("visibilitychange", tick);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
  };
}

/** Module signals outlive a test; the suites call this between cases. */
export function resetProjectRailState(): void {
  forgetRailFocus();
  railViewState.value = INITIAL_RAIL_VIEW_STATE;
  foldedProjects.value = new Set();
  showArchived.value = false;
  hiddenOpen.value = false;
  railNow.value = Date.now();
}
