import type { ITheme } from "@xterm/xterm";
import { deriveChromeColors, type ChromeColors } from "./derive-colors";
import { themeBaseColors } from "./theme-vars";

/**
 * The colours the Windows caption buttons are painted in (`titleBarOverlay`).
 *
 * Both are plain `#rrggbb`, which the host's `isOverlayColor` accepts. No
 * computed-style or canvas resolution is needed: the theme's background and
 * everything `deriveChromeColors` hands back are already hex, and the
 * `color-mix()` declarations in `01-tokens.css` are only the pre-JS fallbacks
 * that `applyThemeVars` overwrites on first paint.
 */
export interface TitleBarOverlayColors {
  readonly color: string;
  readonly symbolColor: string;
}

/**
 * The layout facts that decide which surface sits under the window's
 * top-right corner, where the OS paints the caption buttons.
 */
export interface FrameCornerState {
  /** `tabBarPosition === "left"`: the strip, not the tab bar, owns the corner. */
  readonly sidebar: boolean;
  /** The full-window Settings screen covers the frame row. */
  readonly settingsOpen: boolean;
}

/**
 * Which token paints the corner. The sidebar being collapsed does not change
 * it: collapsing removes `.deck-frame` on the LEFT, and the stage-side strip
 * (DL-18.6) is the corner's occupant either way. The Open board, Mission
 * Control and the file/browser surfaces all start below the frame row, so they
 * never reach it.
 */
function cornerGround(state: FrameCornerState, bg: string, chrome: ChromeColors): string {
  if (state.settingsOpen) {
    return bg; // `.settings-screen`, fixed over the whole window on the stage's `--bg`
  }
  if (!state.sidebar) {
    return chrome.chrome1; // `.tabbar` spans the window (DL-18.3)
  }
  // The strip, an open dock's header and the usage page's header all stand on
  // the stage's `--bg` (DL-18.2, DL-19.2, DL-16.8).
  return bg;
}

export function titleBarOverlayColors(
  theme: ITheme,
  state: FrameCornerState,
): TitleBarOverlayColors {
  const { bg, fg } = themeBaseColors(theme);
  const chrome = deriveChromeColors(bg, fg);
  // `textPrimary` is floored at 8:1 on every chrome surface the corner can
  // be, and `bg` is further from the tone than the sidebar those floors were
  // measured on, so the symbols stay readable in dark and light themes.
  return { color: cornerGround(state, bg, chrome), symbolColor: chrome.textPrimary };
}
