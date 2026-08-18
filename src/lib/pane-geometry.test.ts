import { describe, expect, it } from 'vitest';
import { nearestInDirection, type PaneRect } from './pane-geometry';

function rect(id: number, left: number, top: number, width: number, height: number): PaneRect {
  return { id, left, top, right: left + width, bottom: top + height };
}

// 2x2 grid with 8px divider gaps:
//  1 | 2
//  --+--
//  3 | 4
const GRID: PaneRect[] = [
  rect(1, 0, 0, 100, 100),
  rect(2, 108, 0, 100, 100),
  rect(3, 0, 108, 100, 100),
  rect(4, 108, 108, 100, 100),
];

describe('nearestInDirection', () => {
  it('moves along both axes in a 2x2 grid', () => {
    expect(nearestInDirection(GRID, 1, 'right')).toBe(2);
    expect(nearestInDirection(GRID, 2, 'left')).toBe(1);
    expect(nearestInDirection(GRID, 1, 'down')).toBe(3);
    expect(nearestInDirection(GRID, 4, 'up')).toBe(2);
  });

  it('returns null when no pane lies in that direction', () => {
    expect(nearestInDirection(GRID, 1, 'left')).toBeNull();
    expect(nearestInDirection(GRID, 1, 'up')).toBeNull();
    expect(nearestInDirection(GRID, 4, 'right')).toBeNull();
    expect(nearestInDirection(GRID, 4, 'down')).toBeNull();
  });

  it('prefers a pane overlapping on the perpendicular axis', () => {
    // Active 1 (tall left pane); 2 overlaps vertically, 3 does not.
    // 3's facing edge is nearer, but 2 must win on overlap.
    const panes: PaneRect[] = [
      rect(1, 0, 0, 100, 300),
      rect(2, 400, 100, 100, 100),
      rect(3, 108, 400, 100, 100),
    ];
    expect(nearestInDirection(panes, 1, 'right')).toBe(2);
  });

  it('falls back to non-overlapping candidates when none overlap', () => {
    const panes: PaneRect[] = [
      rect(1, 0, 0, 100, 100),
      rect(2, 108, 200, 100, 100), // below-right, no vertical overlap
    ];
    expect(nearestInDirection(panes, 1, 'right')).toBe(2);
  });

  it('picks the nearest of several overlapping candidates', () => {
    const panes: PaneRect[] = [
      rect(1, 0, 0, 100, 100),
      rect(2, 108, 0, 100, 100),
      rect(3, 216, 0, 100, 100),
    ];
    expect(nearestInDirection(panes, 1, 'right')).toBe(2);
    expect(nearestInDirection(panes, 3, 'left')).toBe(2);
  });

  it('returns null for an unknown active id or single pane', () => {
    expect(nearestInDirection(GRID, 99, 'right')).toBeNull();
    expect(nearestInDirection([rect(1, 0, 0, 100, 100)], 1, 'right')).toBeNull();
  });
});
