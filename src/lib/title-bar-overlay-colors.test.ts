import type { ITheme } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
// Only a type import of `electron` sits behind this file, so the host's own
// predicate runs here without pulling Electron: the renderer must never send
// what the handler would refuse.
import { isOverlayColor } from "../../electron/window-options";
import { DECK_DARK_ID, DECK_LIGHT_ID, THEME_PRESETS, getPreset } from "../settings/themes";
import { TEXT_PRIMARY_FLOOR, contrastRatio } from "./derive-colors";
import { applyThemeVars } from "./theme-vars";
import { titleBarOverlayColors, type FrameCornerState } from "./title-bar-overlay-colors";

/** The four things that can sit under the window's top-right corner. */
const STAGE: FrameCornerState = { sidebar: true, dockPainted: false, settingsOpen: false };
const DOCK: FrameCornerState = { ...STAGE, dockPainted: true };
const TABBAR: FrameCornerState = { sidebar: false, dockPainted: false, settingsOpen: false };
const SETTINGS: FrameCornerState = { ...STAGE, settingsOpen: true };

/** Each state with the CSS custom property the corner's occupant paints. */
const STATES: readonly (readonly [string, FrameCornerState, string])[] = [
  ["sidebar layout: the strip over the stage", STAGE, "--bg"],
  ["sidebar layout, dock open: the dock panel", DOCK, "--sidebar-bg"],
  ["top-tab layout: the tab bar", TABBAR, "--chrome-1"],
  ["top-tab layout, dock open: still the tab bar", { ...TABBAR, dockPainted: true }, "--chrome-1"],
  ["Settings in the sidebar layout", SETTINGS, "--chrome-2"],
  ["Settings in the top-tab layout", { ...TABBAR, settingsOpen: true }, "--chrome-2"],
];

function publishedVars(theme: ITheme): ReadonlyMap<string, string> {
  const written = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string): void {
      written.set(name, value);
    },
  } as unknown as CSSStyleDeclaration;
  applyThemeVars(style, theme);
  return written;
}

describe("titleBarOverlayColors", () => {
  // Literals, so a change to the ladder or to a state's occupant is a visible
  // diff here and not only a pass against the same function.
  it.each([
    [DECK_DARK_ID, "stage strip", STAGE, "#0a0a0a", "#e7e7e7"],
    [DECK_DARK_ID, "dock panel", DOCK, "#141414", "#e7e7e7"],
    [DECK_DARK_ID, "tab bar", TABBAR, "#1b1b1b", "#e7e7e7"],
    [DECK_DARK_ID, "Settings", SETTINGS, "#222222", "#e7e7e7"],
    [DECK_LIGHT_ID, "stage strip", STAGE, "#f5f6f8", "#272727"],
    [DECK_LIGHT_ID, "dock panel", DOCK, "#e9eaec", "#272727"],
    [DECK_LIGHT_ID, "tab bar", TABBAR, "#e9eaec", "#272727"],
    [DECK_LIGHT_ID, "Settings", SETTINGS, "#dfe0e2", "#272727"],
  ])("%s under the %s: exact colours", (id, _occupant, state, color, symbolColor) => {
    expect(titleBarOverlayColors(getPreset(id).theme, state)).toEqual({ color, symbolColor });
  });

  describe.each(THEME_PRESETS.map((preset) => [preset.id, preset.theme] as const))(
    "%s",
    (_id, theme) => {
      it.each(STATES)("%s equals the token the stylesheet paints there", (_name, state, token) => {
        const published = publishedVars(theme);
        expect(titleBarOverlayColors(theme, state)).toEqual({
          color: published.get(token),
          symbolColor: published.get("--text-primary"),
        });
      });

      it.each(STATES)("%s is readable and in a form the host accepts", (_name, state) => {
        const { color, symbolColor } = titleBarOverlayColors(theme, state);
        expect(isOverlayColor(color)).toBe(true);
        expect(isOverlayColor(symbolColor)).toBe(true);
        // `bg` is not one of the surfaces the text floor is checked on, so the
        // stage state is the one this assertion actually guards.
        expect(contrastRatio(symbolColor, color)).toBeGreaterThanOrEqual(TEXT_PRIMARY_FLOOR);
      });
    },
  );

  it("falls back where the chrome does when a theme omits its base colours", () => {
    const published = publishedVars({});
    expect(titleBarOverlayColors({}, STAGE)).toEqual({
      color: published.get("--bg"),
      symbolColor: published.get("--text-primary"),
    });
  });
});
