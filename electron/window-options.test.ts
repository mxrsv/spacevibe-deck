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
  // The renderer only ever derives `#rrggbb` (presets, validated overrides and
  // `mixHex`), so that is the whole accepted format.
  it.each(["#0a0a0a", "#0A0A0A", "#cbcbcb", "#FFFFFF"])("accepts %s", (value) => {
    expect(isOverlayColor(value)).toBe(true);
  });

  // Everything else reaches `setTitleBarOverlay` as untrusted renderer input;
  // the allowlist is the whole defence, so every other CSS colour form, CSS the
  // OS cannot parse, injected trailing text and non-strings must fail it.
  // `#rrggbbaa` is out on purpose: Electron reads 8-digit hex as AARRGGBB.
  it.each([
    "#fff",
    "#0a0a0aff",
    "#1234",
    "#12345",
    "#gggggg",
    "#0a0a0a\n",
    "0a0a0a",
    "rgb(10, 10, 10)",
    "rgba(10, 10, 10, 0.5)",
    "red",
    "var(--bg)",
    "color-mix(in srgb, #000 90%, #fff)",
    "rgb(1, 2, 3); url(x)",
    "",
  ])("rejects %j", (value) => {
    expect(isOverlayColor(value)).toBe(false);
  });

  it.each([12, null, undefined, {}, ["#0a0a0a"]])("rejects the non-string %j", (value) => {
    expect(isOverlayColor(value)).toBe(false);
  });
});
