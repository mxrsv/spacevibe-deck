import type { Theme, UiTokens } from "../settings/theme-schema";

/**
 * The colours the Windows caption buttons are painted in (`titleBarOverlay`).
 *
 * Both are plain `#rrggbb`, which the host's `isOverlayColor` accepts. No
 * computed-style or canvas resolution is needed: every theme colour is
 * declared as opaque hex, and the `color-mix()` declarations in
 * `01-tokens.css` are only the pre-JS fallbacks that `applyThemeVars`
 * overwrites on first paint.
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
function cornerGround(state: FrameCornerState, ui: UiTokens): string {
  if (state.settingsOpen) {
    return ui.bg; // `.settings-screen`, fixed over the whole window on the stage's `--bg`
  }
  if (!state.sidebar) {
    return ui["chrome-1"]; // `.tabbar` spans the window (DL-18.3)
  }
  // The strip, an open dock's header and the usage page's header all stand on
  // the stage's `--bg` (DL-18.2, DL-19.2, DL-16.8).
  return ui.bg;
}

export function titleBarOverlayColors(
  theme: Theme,
  state: FrameCornerState,
): TitleBarOverlayColors {
  // `text-primary` meets 8:1 on `bg` and every chrome surface (DL-3.5), so the
  // symbols stay readable whichever ground the corner is.
  return { color: cornerGround(state, theme.ui), symbolColor: theme.ui["text-primary"] };
}
