import { describe, expect, it } from "vitest";
import { API_KEY, DECK_KEY, ids, layout, viewOf } from "./rail-view-fixtures";
import {
  INITIAL_RAIL_VIEW_STATE,
  setArchived,
  setProjectHidden,
  togglePinned,
} from "./rail-view-state";

/** The session's marks, read back through `buildRailView` the way the rail will. */

describe("pins", () => {
  it("puts pinned rows first, then newest first", () => {
    const state = togglePinned(INITIAL_RAIL_VIEW_STATE, "pane:11");
    expect(layout(viewOf(state))[0]).toEqual([DECK_KEY, ["pane:11", "pane:12", "pane:21"]]);
  });

  it("keeps pins on top under Priority", () => {
    const pinned = togglePinned({ ...INITIAL_RAIL_VIEW_STATE, sorting: "priority" }, "pane:21");
    expect(layout(viewOf(pinned))[0]).toEqual([DECK_KEY, ["pane:21", "pane:11", "pane:12"]]);
  });

  it("leaves the order it found once a pin is taken off again", () => {
    const unpinned = togglePinned(togglePinned(INITIAL_RAIL_VIEW_STATE, "pane:11"), "pane:11");
    expect(layout(viewOf(unpinned))).toEqual(layout(viewOf()));
  });

  it("returns a new state and leaves the one it was given alone", () => {
    const pinned = togglePinned(INITIAL_RAIL_VIEW_STATE, "pane:11");
    expect(pinned.pinned.has("pane:11")).toBe(true);
    expect(INITIAL_RAIL_VIEW_STATE.pinned.size).toBe(0);
  });
});

describe("partitions", () => {
  it("takes an archived row out of every grouping into Archived, and drops its pin", () => {
    const state = setArchived(togglePinned(INITIAL_RAIL_VIEW_STATE, "pane:21"), "pane:21", true);
    expect(state.pinned.has("pane:21")).toBe(false);
    for (const grouping of ["project", "status", "time"] as const) {
      const model = viewOf({ ...state, grouping });
      expect(model.groups.flatMap((group) => ids(group.items))).not.toContain("pane:21");
      expect(ids(model.archived)).toEqual(["pane:21"]);
    }
    // Brought back unpinned: it returns to its newest-first slot, not the top.
    const restored = setArchived(state, "pane:21", false);
    expect(layout(viewOf(restored))[0]).toEqual([DECK_KEY, ["pane:12", "pane:21", "pane:11"]]);
  });

  it("takes a hidden project out of every grouping into Hidden; its archived rows stay archived", () => {
    const state = setArchived(
      setProjectHidden(INITIAL_RAIL_VIEW_STATE, API_KEY, true),
      "pane:31",
      true,
    );
    for (const grouping of ["project", "status", "time"] as const) {
      const model = viewOf({ ...state, grouping });
      const shown = model.groups.flatMap((group) => ids(group.items));
      expect(shown).not.toContain("shell:4");
      expect(model.groups.map((group) => group.key)).not.toContain(API_KEY);
      expect(model.hidden).toEqual([{ key: API_KEY, name: "api" }]);
      expect(ids(model.archived)).toEqual(["pane:31"]);
    }
    expect(viewOf(setProjectHidden(state, API_KEY, false)).hidden).toEqual([]);
  });
});
