import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FRAME_HEIGHT_PX,
  INITIAL_OVERLAY_COLORS,
  isOverlayColor,
  windowChromeOptions,
} from "./window-options";

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
    // Strict, so a `titleBarOverlay: undefined` key sneaking in also fails.
    expect(windowChromeOptions(platform, INITIAL_OVERLAY_COLORS)).toStrictEqual({
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

describe("isOverlayColor", () => {
  it.each([
    "#fff",
    "#0a0a0a",
    "#0A0A0AFF",
    "rgb(10, 10, 10)",
    "rgba(10, 10, 10, 0.5)",
    "rgb(10.5, 20, 30)",
    "rgba(0,0,0,.25)",
  ])("accepts %s", (value) => {
    expect(isOverlayColor(value)).toBe(true);
  });

  // Everything else reaches `setTitleBarOverlay` as untrusted renderer input;
  // the allowlist is the whole defence, so CSS the OS cannot parse, injected
  // trailing text and non-strings must all fail it.
  it.each([
    "red",
    "var(--bg)",
    "color-mix(in srgb, #000 90%, #fff)",
    "#12",
    "#1234",
    "#gggggg",
    "#fff\n",
    "rgb(1, 2)",
    "rgb(a, b, c)",
    "rgb(1, 2, 3); url(x)",
    "rgb(1, 2, 3, 4, 5)",
    // Well-formed, but longer than any real computed colour: the cap bounds the work.
    `rgb(1,${" ".repeat(70)}2, 3)`,
    "",
  ])("rejects %j", (value) => {
    expect(isOverlayColor(value)).toBe(false);
  });

  it.each([12, null, undefined, {}, ["#fff"]])("rejects the non-string %j", (value) => {
    expect(isOverlayColor(value)).toBe(false);
  });
});
