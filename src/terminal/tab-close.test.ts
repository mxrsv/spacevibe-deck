import { describe, expect, it } from "vitest";
import { activeAfterClose } from "./tab-close";

describe("activeAfterClose", () => {
  it("returns -1 when the last tab is removed", () => {
    expect(activeAfterClose(0, 0, 1)).toBe(-1);
  });

  it("keeps the active index when a tab to its right is closed", () => {
    // [0 1* 2] close index 2 → active still 1
    expect(activeAfterClose(2, 1, 3)).toBe(1);
  });

  it("shifts active left when a tab to its left is closed", () => {
    // [0 1 2*] close index 0 → active 2 becomes 1
    expect(activeAfterClose(0, 2, 3)).toBe(1);
  });

  it("clamps when the active tab was the last one", () => {
    // [0 1 2*] close index 2 (the active) → clamp to new last (1)
    expect(activeAfterClose(2, 2, 3)).toBe(1);
  });

  it("clamps when active sits past the new end", () => {
    // [0* 1] close index 0 → active 0, no left-shift, clamp to 0
    expect(activeAfterClose(0, 0, 2)).toBe(0);
  });

  it("is stable regardless of the passed index magnitude (re-derived removeAt)", () => {
    // A concurrent close shrank the list from 4 to 3 before this ran; the
    // caller re-derived removeAt=1 against the *current* list, so the math
    // must use countBefore=3, never the stale original count.
    expect(activeAfterClose(1, 2, 3)).toBe(1);
  });
});
