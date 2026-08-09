import { describe, expect, it } from "vitest";
import { reorderDropAt } from "./reorder-drop-index";

// Four 40px rows starting at 0 → centres at 20, 60, 100, 140.
const MIDPOINTS = [20, 60, 100, 140];

describe("reorderDropAt", () => {
  it("puts the pointer above everything in gap 0", () => {
    expect(reorderDropAt(MIDPOINTS, 5, 2)).toEqual({ gap: 0, to: 0 });
  });

  it("puts the pointer below everything in the last gap", () => {
    expect(reorderDropAt(MIDPOINTS, 200, 0)).toEqual({ gap: 4, to: 3 });
  });

  it("flips at the midpoint, not at the row edge", () => {
    // Row 1 spans 40–80: 41 is still gap 1, 61 has crossed its centre.
    expect(reorderDropAt(MIDPOINTS, 41, 3).gap).toBe(1);
    expect(reorderDropAt(MIDPOINTS, 61, 3).gap).toBe(2);
  });

  it("reports the row's own slot as a no-op move", () => {
    // Dragging row 1 anywhere inside its own gap must resolve back to 1, so
    // the caller can skip the move instead of writing an identical order.
    expect(reorderDropAt(MIDPOINTS, 41, 1).to).toBe(1);
    expect(reorderDropAt(MIDPOINTS, 79, 1).to).toBe(1);
  });

  it("drops the gap by one once the drag is past its own slot", () => {
    // Gap 3 with row 0 removed is index 2 — the visual gap counts a row that
    // will no longer be there.
    expect(reorderDropAt(MIDPOINTS, 105, 0)).toEqual({ gap: 3, to: 2 });
    // Moving upward crosses no removed row, so gap and destination agree.
    expect(reorderDropAt(MIDPOINTS, 105, 3)).toEqual({ gap: 3, to: 3 });
  });

  it("returns gap 0 for an empty list", () => {
    expect(reorderDropAt([], 999, 0)).toEqual({ gap: 0, to: 0 });
  });
});
