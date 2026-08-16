/**
 * The arithmetic behind a docked panel's resize drag — shared by the file
 * explorer's seam (DL-19.4) and the navigation sidebar's own seam (DL-18.9).
 *
 * Both seams answer the same question on every pointer move: given the width
 * the raw pointer delta asks for, what width does the column take, and has the
 * drag gone far enough past the floor to mean "collapse this" rather than
 * "narrow this"? It lives here as a pure function because that threshold is
 * the only part of the gesture worth testing and this repo has no `<App>`
 * render harness — a rule buried inside a pointer handler is a rule nothing
 * checks.
 *
 * The raw width is deliberately NOT pre-clamped by the caller: clamping maps
 * every overdrag onto the floor, so a clamped value cannot tell "resting at
 * the minimum" apart from "dragged 200px past it", and that difference is the
 * whole gesture.
 */
import {
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../settings/settings-schema";

export interface PanelWidthBounds {
  readonly min: number;
  readonly max: number;
  /** Below this RAW width the drag reads as "collapse", not "narrow". */
  readonly collapseBelow: number;
}

export interface PanelDragOutcome {
  /** Width to paint during the drag, and to persist when it settles. */
  readonly width: number;
  /** True while the gesture is past `collapseBelow`. */
  readonly collapsed: boolean;
}

/**
 * How far past the floor the pointer travels before a drag means "collapse".
 * One figure for both panels: the gesture is the same gesture, and two
 * thresholds would make the same overdrag mean different things on the two
 * edges of the same window.
 */
export const PANEL_COLLAPSE_SLACK = 60;

export const DOCK_DRAG_BOUNDS: PanelWidthBounds = {
  min: DOCK_WIDTH_MIN,
  max: DOCK_WIDTH_MAX,
  collapseBelow: DOCK_WIDTH_MIN - PANEL_COLLAPSE_SLACK,
};

export const SIDEBAR_DRAG_BOUNDS: PanelWidthBounds = {
  min: SIDEBAR_WIDTH_MIN,
  max: SIDEBAR_WIDTH_MAX,
  collapseBelow: SIDEBAR_WIDTH_MIN - PANEL_COLLAPSE_SLACK,
};

/**
 * A hidden sidebar has no width at all (DL-18.9, revised 2026-08-16).
 *
 * It kept an icon rail until that revision, for one reason: in sidebar layout
 * the frame row is the top of THIS column (DL-18.3), so a column of zero width
 * takes the traffic lights' own row with it. What made zero possible is that
 * the frame row's contents moved — the feature toolbar to the stage strip, the
 * hide control to the strip's leading edge — leaving the OS buttons, which the
 * stage strip reserves an inset for exactly the way the frame row did.
 */
export const SIDEBAR_HIDDEN_WIDTH = 0;

export function resolvePanelDrag(
  rawWidth: number,
  bounds: PanelWidthBounds,
): PanelDragOutcome {
  return {
    width: Math.min(bounds.max, Math.max(bounds.min, Math.round(rawWidth))),
    collapsed: rawWidth < bounds.collapseBelow,
  };
}
