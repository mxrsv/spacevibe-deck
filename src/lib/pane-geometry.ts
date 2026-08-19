/**
 * Pure directional pane navigation: given pane bounding boxes and the
 * active pane, find the nearest pane in a direction. Candidates must lie
 * fully beyond the active pane's facing edge; panes overlapping the
 * active pane on the perpendicular axis are preferred, then the smallest
 * facing-edge-center distance wins.
 */

export type FocusDirection = "left" | "right" | "up" | "down";

export interface PaneRect {
  readonly id: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

// Dividers leave small gaps between slots; treat near-touching edges as beyond.
const EDGE_TOLERANCE_PX = 1;

function isBeyond(active: PaneRect, other: PaneRect, dir: FocusDirection): boolean {
  switch (dir) {
    case "left":
      return other.right <= active.left + EDGE_TOLERANCE_PX;
    case "right":
      return other.left >= active.right - EDGE_TOLERANCE_PX;
    case "up":
      return other.bottom <= active.top + EDGE_TOLERANCE_PX;
    case "down":
      return other.top >= active.bottom - EDGE_TOLERANCE_PX;
  }
}

/** Overlap length on the axis perpendicular to the move direction. */
function perpendicularOverlap(a: PaneRect, b: PaneRect, dir: FocusDirection): number {
  return dir === "left" || dir === "right"
    ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    : Math.min(a.right, b.right) - Math.max(a.left, b.left);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Center of the edge of `r` facing in `dir`. */
function edgeCenter(r: PaneRect, dir: FocusDirection): Point {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  switch (dir) {
    case "left":
      return { x: r.left, y: cy };
    case "right":
      return { x: r.right, y: cy };
    case "up":
      return { x: cx, y: r.top };
    case "down":
      return { x: cx, y: r.bottom };
  }
}

const OPPOSITE: Readonly<Record<FocusDirection, FocusDirection>> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
};

/** Distance between the active pane's facing edge and the candidate's near edge. */
function edgeCenterDistance(active: PaneRect, other: PaneRect, dir: FocusDirection): number {
  const from = edgeCenter(active, dir);
  const to = edgeCenter(other, OPPOSITE[dir]);
  return Math.hypot(from.x - to.x, from.y - to.y);
}

/** Id of the nearest pane in `dir`, or null when none qualifies. */
export function nearestInDirection(
  panes: readonly PaneRect[],
  activeId: number,
  dir: FocusDirection,
): number | null {
  const active = panes.find((pane) => pane.id === activeId);
  if (active === undefined) {
    return null;
  }
  const beyond = panes.filter((pane) => pane.id !== activeId && isBeyond(active, pane, dir));
  if (beyond.length === 0) {
    return null;
  }
  const overlapping = beyond.filter((pane) => perpendicularOverlap(active, pane, dir) > 0);
  const pool = overlapping.length > 0 ? overlapping : beyond;
  let best = pool[0];
  let bestDistance = edgeCenterDistance(active, best, dir);
  for (const pane of pool.slice(1)) {
    const distance = edgeCenterDistance(active, pane, dir);
    if (distance < bestDistance) {
      best = pane;
      bestDistance = distance;
    }
  }
  return best.id;
}
