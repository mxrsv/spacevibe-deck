/**
 * The project-first rail's session marks: pin, archive, hide, search and the
 * Organize menu's choices. Session-only by owner decision F2: no settings key,
 * no journal, no IPC. The caller keeps one `RailViewState` in a signal and
 * replaces it through these helpers; `buildRailView` reads it.
 */

export type RailGrouping = "project" | "status" | "time";
export type RailSorting = "updated" | "priority";

export interface RailViewState {
  /** `RailItem.id`s. */
  readonly pinned: ReadonlySet<string>;
  /** `RailItem.id`s. */
  readonly archived: ReadonlySet<string>;
  /** Project keys (`RailStreamGroup.orderKey`). */
  readonly hidden: ReadonlySet<string>;
  readonly query: string;
  readonly grouping: RailGrouping;
  readonly sorting: RailSorting;
}

export const INITIAL_RAIL_VIEW_STATE: RailViewState = {
  pinned: new Set(),
  archived: new Set(),
  hidden: new Set(),
  query: "",
  grouping: "project",
  sorting: "updated",
};

function withKey(set: ReadonlySet<string>, key: string, present: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (present) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

export function togglePinned(state: RailViewState, id: string): RailViewState {
  return { ...state, pinned: withKey(state.pinned, id, !state.pinned.has(id)) };
}

/** Archiving drops the pin, so a row brought back does not jump to the top unasked. */
export function setArchived(state: RailViewState, id: string, archived: boolean): RailViewState {
  return {
    ...state,
    archived: withKey(state.archived, id, archived),
    pinned: archived ? withKey(state.pinned, id, false) : state.pinned,
  };
}

export function setProjectHidden(
  state: RailViewState,
  key: string,
  hidden: boolean,
): RailViewState {
  return { ...state, hidden: withKey(state.hidden, key, hidden) };
}
