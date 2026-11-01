import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES, DECK_DARK_THEME, DECK_LIGHT_THEME } from "./built-in-themes";
import { DEFAULT_SETTINGS } from "./settings-schema";
import {
  activeTheme,
  conversionDiscardsData,
  customThemes,
  DECK_DARK_ID,
  DECK_LIGHT_ID,
  getTheme,
  resolveTheme,
  themeFromTerminalColors,
  themeModeOf,
} from "./themes";

const RETIRED_IDS = ["tokyo-night", "dracula", "one-dark", "catppuccin-mocha"] as const;

describe("resolveTheme", () => {
  // xterm defaults overviewRulerBorder to #ffffff — a white hairline next to
  // the scrollbar once overviewRuler.width is set (see terminal/pane.ts).
  it.each(BUILT_IN_THEMES)("hides the overview ruler border on $id", (theme) => {
    const terminal = resolveTheme({ ...DEFAULT_SETTINGS, themeId: theme.id });

    expect(terminal.overviewRulerBorder).toBe(theme.terminal.background);
  });

  it.each(BUILT_IN_THEMES)("hands xterm $id's own terminal group", (theme) => {
    const terminal = resolveTheme({ ...DEFAULT_SETTINGS, themeId: theme.id });

    expect(terminal).toEqual({
      ...theme.terminal,
      overviewRulerBorder: theme.terminal.background,
    });
  });

  it("falls back to Deck Dark for an unknown theme id", () => {
    const terminal = resolveTheme({ ...DEFAULT_SETTINGS, themeId: "does-not-exist" });

    expect(terminal.background).toBe(DECK_DARK_THEME.terminal.background);
  });
});

describe("the two canonical modes", () => {
  it("ships Deck Dark first, so every fallback lands on it", () => {
    expect(BUILT_IN_THEMES[0].id).toBe(DECK_DARK_ID);
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toContain(DECK_LIGHT_ID);
  });

  it("defaults a new install to the dark mode", () => {
    expect(DEFAULT_SETTINGS.themeId).toBe(DECK_DARK_ID);
  });

  it("resolves an unknown id to the dark mode", () => {
    expect(getTheme("does-not-exist").id).toBe(DECK_DARK_ID);
  });

  // The four retired palettes were all dark, so falling back needs no map.
  it.each(RETIRED_IDS)("falls back from the retired %s to Deck Dark", (id) => {
    expect(getTheme(id)).toBe(DECK_DARK_THEME);
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: id })).toBe("dark");
  });
});

describe("activeTheme", () => {
  it.each(BUILT_IN_THEMES)("returns $id for its own id", (theme) => {
    expect(activeTheme({ ...DEFAULT_SETTINGS, themeId: theme.id })).toBe(theme);
  });
});

describe("themeModeOf", () => {
  it("reports each canonical mode as itself", () => {
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: DECK_LIGHT_ID })).toBe("light");
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: DECK_DARK_ID })).toBe("dark");
  });

  it.each(BUILT_IN_THEMES)("reports $id by its declared type", (theme) => {
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: theme.id })).toBe(theme.type);
  });

  it("classifies an unknown id through the fallback theme", () => {
    expect(themeModeOf({ ...DEFAULT_SETTINGS, themeId: "file:gone.json" })).toBe("dark");
  });
});

describe("themeFromTerminalColors", () => {
  const LIGHT_FILE = {
    background: "#fdf6e3",
    foreground: "#586e75",
    cursor: "#586e75",
    selectionBackground: "#eee8d5",
    blue: "#268bd2",
  };

  it("keeps the chrome and editor of the built-in of its type", () => {
    const theme = themeFromTerminalColors("file:solarized.json", "Solarized", LIGHT_FILE);

    expect(theme.type).toBe("light");
    expect(theme.ui).toEqual(DECK_LIGHT_THEME.ui);
    expect(theme.editor).toEqual(DECK_LIGHT_THEME.editor);
  });

  it("replaces the terminal, keeping the built-in's value for a slot the file leaves out", () => {
    const theme = themeFromTerminalColors("file:solarized.json", "Solarized", LIGHT_FILE);

    expect(theme.id).toBe("file:solarized.json");
    expect(theme.name).toBe("Solarized");
    expect(theme.terminal.background).toBe("#fdf6e3");
    expect(theme.terminal.blue).toBe("#268bd2");
    expect(theme.terminal.red).toBe(DECK_LIGHT_THEME.terminal.red);
    expect(theme.terminal.cursorAccent).toBe("#fdf6e3");
  });

  it("refuses a value a theme cannot declare", () => {
    const theme = themeFromTerminalColors("file:x.json", "X", {
      ...LIGHT_FILE,
      red: "rgba(255, 0, 0, 0.5)",
    });

    expect(theme.terminal.red).toBe(DECK_LIGHT_THEME.terminal.red);
  });

  it("types a dark file as Deck Dark", () => {
    const theme = themeFromTerminalColors("file:night.json", "Night", {
      background: "#101014",
      foreground: "#e8e3d8",
      cursor: "#e8e3d8",
      selectionBackground: "#303040",
    });

    expect(theme.type).toBe("dark");
    expect(theme.ui).toEqual(DECK_DARK_THEME.ui);
  });
});

describe("conversionDiscardsData", () => {
  it("is false for a built-in or a retired id", () => {
    expect(conversionDiscardsData({ ...DEFAULT_SETTINGS, themeId: "paper" })).toBe(false);
    expect(conversionDiscardsData({ ...DEFAULT_SETTINGS, themeId: "tokyo-night" })).toBe(false);
  });

  it("is true for an imported theme, which lives in a file", () => {
    customThemes.value = [
      {
        fileName: "solarized.json",
        theme: { ...DECK_DARK_THEME, id: "file:solarized.json", name: "Solarized" },
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
      customThemes.value = [];
    }
  });
});
