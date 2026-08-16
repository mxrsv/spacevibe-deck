import { describe, expect, it } from "vitest";
import {
  DOCK_DRAG_BOUNDS,
  PANEL_COLLAPSE_SLACK,
  SIDEBAR_DRAG_BOUNDS,
  SIDEBAR_HIDDEN_WIDTH,
  resolvePanelDrag,
} from "./panel-resize";
import {
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../settings/settings-schema";

describe("resolvePanelDrag", () => {
  it("keeps a width inside the range and reports no collapse", () => {
    expect(resolvePanelDrag(400, DOCK_DRAG_BOUNDS)).toEqual({
      width: 400,
      collapsed: false,
    });
  });

  it("rounds sub-pixel drags, since the width becomes a CSS pixel value", () => {
    expect(resolvePanelDrag(400.6, DOCK_DRAG_BOUNDS).width).toBe(401);
  });

  it("clamps to the ceiling without ever collapsing", () => {
    expect(resolvePanelDrag(9000, DOCK_DRAG_BOUNDS)).toEqual({
      width: DOCK_WIDTH_MAX,
      collapsed: false,
    });
    expect(resolvePanelDrag(9000, SIDEBAR_DRAG_BOUNDS)).toEqual({
      width: SIDEBAR_WIDTH_MAX,
      collapsed: false,
    });
  });

  it("holds at the floor for an overdrag that has not yet earned the collapse", () => {
    // Exactly on the threshold is still a resize: the gesture has to go PAST
    // it, so a user resting on the boundary does not lose the panel.
    expect(
      resolvePanelDrag(DOCK_DRAG_BOUNDS.collapseBelow, DOCK_DRAG_BOUNDS),
    ).toEqual({ width: DOCK_WIDTH_MIN, collapsed: false });
  });

  it("arms the collapse once the raw width falls past the floor by the slack", () => {
    expect(
      resolvePanelDrag(DOCK_DRAG_BOUNDS.collapseBelow - 1, DOCK_DRAG_BOUNDS),
    ).toEqual({ width: DOCK_WIDTH_MIN, collapsed: true });
    expect(
      resolvePanelDrag(
        SIDEBAR_DRAG_BOUNDS.collapseBelow - 1,
        SIDEBAR_DRAG_BOUNDS,
      ),
    ).toEqual({ width: SIDEBAR_WIDTH_MIN, collapsed: true });
  });

  it("reads a negative raw width — a drag past the window edge — as a collapse", () => {
    expect(resolvePanelDrag(-400, SIDEBAR_DRAG_BOUNDS)).toEqual({
      width: SIDEBAR_WIDTH_MIN,
      collapsed: true,
    });
  });

  it("derives both thresholds from one slack figure", () => {
    expect(DOCK_DRAG_BOUNDS.collapseBelow).toBe(
      DOCK_WIDTH_MIN - PANEL_COLLAPSE_SLACK,
    );
    expect(SIDEBAR_DRAG_BOUNDS.collapseBelow).toBe(
      SIDEBAR_WIDTH_MIN - PANEL_COLLAPSE_SLACK,
    );
  });
});

describe("SIDEBAR_HIDDEN_WIDTH", () => {
  it("is zero — a hidden column keeps no rail (DL-18.9, revised 2026-08-16)", () => {
    expect(SIDEBAR_HIDDEN_WIDTH).toBe(0);
  });

  it("sits below the floor a drag can land on, so hiding is never a resize", () => {
    expect(SIDEBAR_HIDDEN_WIDTH).toBeLessThan(SIDEBAR_WIDTH_MIN);
  });
});
