import { describe, expect, it } from "vitest";
import { POPOVER_EDGE, POPOVER_GAP, POPOVER_WIDTH, placePopover } from "./attention-placement";

const WINDOW = { width: 1000, height: 700 };

describe("placePopover", () => {
  it("hangs under the chip with the trailing edges aligned", () => {
    const placed = placePopover({ right: 940, bottom: 29 }, WINDOW);

    expect(placed.right).toBe(60);
    expect(placed.top).toBe(29 + POPOVER_GAP);
  });

  it("keeps the margin when the chip sits against the window's edge", () => {
    expect(placePopover({ right: 1000, bottom: 29 }, WINDOW).right).toBe(POPOVER_EDGE);
  });

  it("slides right rather than leave the window on the left", () => {
    // A docked panel can leave the strip's trailing end near the window's left.
    const placed = placePopover({ right: 200, bottom: 29 }, WINDOW);

    expect(WINDOW.width - placed.right - POPOVER_WIDTH).toBe(POPOVER_EDGE);
  });

  it("shrinks to a window narrower than the surface", () => {
    const placed = placePopover({ right: 300, bottom: 29 }, { width: 300, height: 700 });

    expect(placed.right).toBe(POPOVER_EDGE);
  });

  it("lets the list scroll in what is left below it", () => {
    expect(placePopover({ right: 940, bottom: 29 }, WINDOW).maxHeight).toBe(
      700 - (29 + POPOVER_GAP) - POPOVER_EDGE,
    );
    expect(placePopover({ right: 940, bottom: 800 }, WINDOW).maxHeight).toBe(0);
  });

  it("places a wider surface by its own width", () => {
    const placed = placePopover({ right: 200, bottom: 29 }, WINDOW, 360);

    expect(WINDOW.width - placed.right - 360).toBe(POPOVER_EDGE);
  });
});
