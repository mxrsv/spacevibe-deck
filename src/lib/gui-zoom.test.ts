import { describe, expect, it } from "vitest";
import {
  compensatedFontSize,
  cssRectToWindow,
  DEFAULT_GUI_ZOOM,
  GUI_ZOOM_STEPS,
  parseGuiZoom,
  stepGuiZoom,
} from "./gui-zoom";

describe("GUI zoom steps", () => {
  it("offers exactly the five owner-approved factors", () => {
    expect(GUI_ZOOM_STEPS).toEqual([0.85, 0.9, 1, 1.1, 1.25]);
  });

  it("walks up the ladder and clamps at the top", () => {
    let zoom = DEFAULT_GUI_ZOOM;
    const visited: number[] = [];
    for (let press = 0; press < 4; press += 1) {
      zoom = stepGuiZoom(zoom, 1);
      visited.push(zoom);
    }
    expect(visited).toEqual([1.1, 1.25, 1.25, 1.25]);
  });

  it("walks down the ladder and clamps at the bottom", () => {
    let zoom = DEFAULT_GUI_ZOOM;
    const visited: number[] = [];
    for (let press = 0; press < 4; press += 1) {
      zoom = stepGuiZoom(zoom, -1);
      visited.push(zoom);
    }
    expect(visited).toEqual([0.9, 0.85, 0.85, 0.85]);
  });

  it("steps from a value that is no step as if it were the default", () => {
    expect(stepGuiZoom(3, 1)).toBe(1.1);
    expect(stepGuiZoom(Number.NaN, -1)).toBe(0.9);
  });
});

describe("parseGuiZoom", () => {
  it.each(GUI_ZOOM_STEPS)("keeps the step %f", (step) => {
    expect(parseGuiZoom(step)).toBe(step);
  });

  it.each([0, -1, 0.95, 2, Number.NaN, Number.POSITIVE_INFINITY, "1.1", null, undefined, {}])(
    "falls back to 1 for %s",
    (bad) => {
      expect(parseGuiZoom(bad)).toBe(1);
    },
  );
});

describe("compensatedFontSize", () => {
  it.each(GUI_ZOOM_STEPS)("keeps a 13px font 13 physical pixels at zoom %f", (zoom) => {
    // The page draws one CSS pixel `zoom` physical pixels wide.
    expect(compensatedFontSize(13, zoom) * zoom).toBeCloseTo(13, 2);
  });

  it("is the setting itself at zoom 1 and for a bad factor", () => {
    expect(compensatedFontSize(13, 1)).toBe(13);
    expect(compensatedFontSize(13, 7)).toBe(13);
  });

  it("carries no float noise into the font option", () => {
    expect(compensatedFontSize(13, 1.1)).toBe(11.818);
    expect(compensatedFontSize(13, 0.85)).toBe(15.294);
  });
});

describe("cssRectToWindow", () => {
  it("is the identity at zoom 1", () => {
    expect(cssRectToWindow({ x: 10, y: 20, width: 300, height: 200 }, 1)).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
  });

  it("scales a panel measured in CSS pixels to window pixels", () => {
    expect(cssRectToWindow({ x: 275, y: 40, width: 600, height: 400 }, 1.25)).toEqual({
      x: 344,
      y: 50,
      width: 750,
      height: 500,
    });
  });

  it("rounds edges, so two neighbours that met in CSS still meet", () => {
    const left = cssRectToWindow({ x: 0, y: 0, width: 333, height: 10 }, 1.1);
    const right = cssRectToWindow({ x: 333, y: 0, width: 333, height: 10 }, 1.1);
    expect(left.x + left.width).toBe(right.x);
  });

  it("never returns a negative size", () => {
    expect(cssRectToWindow({ x: 10, y: 20, width: -8, height: -8 }, 0.85)).toMatchObject({
      width: 0,
      height: 0,
    });
  });
});
