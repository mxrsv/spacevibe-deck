import { describe, expect, it } from "vitest";
import {
  checkChromeTextContrast,
  contrastRatio,
  TERMINAL_CURSOR_FLOOR,
  TERMINAL_TEXT_FLOOR,
} from "../lib/derive-colors";
import { DEFAULT_SETTINGS } from "./settings-schema";
import {
  conversionDiscardsData,
  customPresets,
  DECK_DARK_ID,
  DECK_LIGHT_ID,
  getPreset,
  resolveTheme,
  THEME_PRESETS,
  themeModeOf,
} from "./themes";

describe("resolveTheme", () => {
  // xterm defaults overviewRulerBorder to #ffffff — a white hairline next to
  // the scrollbar once overviewRuler.width is set (see terminal/pane.ts).
  it.each(THEME_PRESETS)("hides the overview ruler border on $id", (preset) => {
    const theme = resolveTheme({ ...DEFAULT_SETTINGS, themeId: preset.id });

    expect(theme.overviewRulerBorder).toBe(theme.background);
  });

  it("follows a background color override", () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: "#101014" },
    });

    expect(theme.background).toBe("#101014");
    expect(theme.overviewRulerBorder).toBe("#101014");
  });

  it("falls back to the first preset for an unknown theme id", () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      themeId: "does-not-exist",
    });

    expect(theme.background).toBe(THEME_PRESETS[0].theme.background);
    expect(theme.overviewRulerBorder).toBe(theme.background);
  });

  it("lets a color override win over the preset", () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      themeId: "tokyo-night",
      colorOverrides: { foreground: "#abcdef" },
    });

    expect(theme.foreground).toBe("#abcdef");
    expect(theme.background).toBe(getPreset("tokyo-night").theme.background);
  });

  it("pins cursorAccent to the resolved background", () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: "#101014" },
    });

    expect(theme.cursorAccent).toBe("#101014");
  });
});

describe("the two canonical modes", () => {
  it("ships Dark and Light as the first two presets", () => {
    expect(THEME_PRESETS.slice(0, 2).map((preset) => preset.id)).toEqual([
      DECK_DARK_ID,
      DECK_LIGHT_ID,
    ]);
  });

  it("defaults a new install to the dark mode", () => {
    expect(DEFAULT_SETTINGS.themeId).toBe(DECK_DARK_ID);
  });

  // Pins the SEMANTIC fallback, which the `THEME_PRESETS[0]` test above cannot:
  // that one agrees with the array whatever order it is in.
  it("resolves an unknown id to the dark mode, not to a legacy palette", () => {
    expect(getPreset("does-not-exist").id).toBe(DECK_DARK_ID);
  });

  it.each([DECK_DARK_ID, DECK_LIGHT_ID])("derives chrome that clears DL-3.5 on %s", (id) => {
    const preset = getPreset(id);
    const check = checkChromeTextContrast(preset.theme.background, preset.theme.foreground);

    expect(check.ok ? null : check.reason).toBeNull();
  });

  it.each([DECK_DARK_ID, DECK_LIGHT_ID])("keeps terminal text and cursor legible on %s", (id) => {
    const { theme } = getPreset(id);

    expect(contrastRatio(theme.foreground, theme.background)).toBeGreaterThanOrEqual(
      TERMINAL_TEXT_FLOOR,
    );
    expect(contrastRatio(theme.cursor, theme.background)).toBeGreaterThanOrEqual(
      TERMINAL_CURSOR_FLOOR,
    );
  });

  it("keeps every legacy built-in id resolvable", () => {
    for (const id of ["tokyo-night", "dracula", "one-dark", "catppuccin-mocha"]) {
      expect(getPreset(id).id).toBe(id);
    }
  });
});

describe("themeModeOf", () => {
  it("reports each canonical mode as itself", () => {
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: DECK_LIGHT_ID })).toBe("light");
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: DECK_DARK_ID })).toBe("dark");
  });

  it("classifies a legacy theme by the background it resolves to", () => {
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: "tokyo-night" })).toBe("dark");
  });

  // The selected segment must describe what the user is LOOKING at. An
  // override is what the app actually paints, so it decides.
  it("follows a background override past the preset it overrides", () => {
    expect(
      themeModeOf({
        ...DEFAULT_SETTINGS,
        themeId: DECK_DARK_ID,
        colorOverrides: { background: "#fafafa" },
      }),
    ).toBe("light");
  });

  it("classifies an unknown id through the fallback preset", () => {
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: "file:gone.json" })).toBe("dark");
  });
});

describe("conversionDiscardsData", () => {
  it("is false for a legacy built-in with nothing overridden", () => {
    expect(conversionDiscardsData({ ...DEFAULT_SETTINGS, themeId: "gruvbox" })).toBe(false);
  });

  it("is true while any colour override is set", () => {
    expect(
      conversionDiscardsData({
        ...DEFAULT_SETTINGS,
        colorOverrides: { foreground: "#abcdef" },
      }),
    ).toBe(true);
  });

  it("is true for an imported theme, which lives in a file", () => {
    customPresets.value = [
      {
        id: "file:solarized.json",
        label: "Solarized",
        fileName: "solarized.json",
        theme: getPreset(DECK_DARK_ID).theme,
      },
    ];
    try {
      expect(
        conversionDiscardsData({
          ...DEFAULT_SETTINGS,
          themeId: "file:solarized.json",
        }),
      ).toBe(true);
    } finally {
      customPresets.value = [];
    }
  });
});
