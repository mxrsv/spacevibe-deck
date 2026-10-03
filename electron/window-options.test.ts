import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRAME_HEIGHT_PX, INITIAL_OVERLAY_COLORS, windowChromeOptions } from "./window-options";

const TOKENS = readFileSync("src/styles/01-tokens.css", "utf8");

/** A `:root` custom property's value, read the way the stylesheet declares it. */
function token(name: string): string {
  const match = TOKENS.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"));
  if (match === null) {
    throw new Error(`${name} is not declared in 01-tokens.css`);
  }
  return match[1].trim();
}

describe("windowChromeOptions", () => {
  // macOS must not change: these are the options `createWindow` passed before
  // the extraction, whole-object, so an added or renamed key turns this red.
  it.each(["darwin", "linux"] as const)("keeps %s on today's hiddenInset options", (platform) => {
    expect(windowChromeOptions(platform, INITIAL_OVERLAY_COLORS)).toEqual({
      titleBarStyle: "hiddenInset",
    });
  });

  it("paints Windows caption buttons inside the frame row", () => {
    expect(windowChromeOptions("win32", INITIAL_OVERLAY_COLORS)).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        height: 34,
        color: INITIAL_OVERLAY_COLORS.color,
        symbolColor: INITIAL_OVERLAY_COLORS.symbolColor,
      },
    });
  });
});

describe("window chrome constants", () => {
  it("keeps the overlay height equal to --frame-h", () => {
    expect(`${FRAME_HEIGHT_PX}px`).toBe(token("--frame-h"));
  });

  it("starts the overlay on the pre-render ground", () => {
    expect(INITIAL_OVERLAY_COLORS).toEqual({ color: token("--bg"), symbolColor: token("--fg") });
  });
});
