/**
 * The platform-dependent part of `createWindow`'s `BrowserWindow` options:
 * how the OS window chrome meets Deck's one frame row (DL-18).
 */
import type { BrowserWindowConstructorOptions } from "electron";

/** Mirrors `--frame-h` in `src/styles/01-tokens.css`; a test fails if they drift. */
export const FRAME_HEIGHT_PX = 34;

export interface OverlayColors {
  readonly color: string;
  readonly symbolColor: string;
}

/**
 * The overlay's colours until the renderer publishes the theme's own. They
 * mirror the pre-render ground: `color` is `--bg`'s default (`backgroundColor`
 * in `main.ts`, `FALLBACK_BG` in `src/lib/theme-vars.ts`) and `symbolColor` is
 * `--fg`'s (`FALLBACK_FG`). Same drift rule as `backgroundColor`: change one
 * without the others and the caption buttons flash a colour the app never
 * shows again between window open and the first theme sync.
 */
export const INITIAL_OVERLAY_COLORS: OverlayColors = {
  color: "#0a0a0a",
  symbolColor: "#cbcbcb",
};

export type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay"
>;

/**
 * Everything that is not Windows keeps `hiddenInset`, byte for byte: on macOS
 * the OS paints its traffic lights on the left, and Deck reserves that side
 * (`--frame-lights-w`). Windows has no inset variant — `hidden` drops the
 * native frame and `titleBarOverlay` has the OS paint its caption buttons
 * inside the same 34px row, on the right.
 */
export function windowChromeOptions(
  platform: NodeJS.Platform,
  overlay: OverlayColors,
): WindowChromeOptions {
  if (platform !== "win32") {
    return { titleBarStyle: "hiddenInset" };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      height: FRAME_HEIGHT_PX,
      color: overlay.color,
      symbolColor: overlay.symbolColor,
    },
  };
}
