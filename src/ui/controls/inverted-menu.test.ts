// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DECK_DARK_THEME, DECK_LIGHT_THEME, BUILT_IN_THEMES } from "../../settings/built-in-themes";
import { applyThemeVars } from "../../lib/theme-vars";
import { invertedMenuClass } from "./inverted-menu";

const root = document.documentElement.style;
const palette = BUILT_IN_THEMES.find((theme) => theme.id === "paper");

afterEach(() => applyThemeVars(root, DECK_DARK_THEME));

describe("invertedMenuClass", () => {
  it.each([DECK_DARK_THEME, DECK_LIGHT_THEME])("inverts the menu on $id", (theme) => {
    applyThemeVars(root, theme);
    expect(invertedMenuClass()).toBe("dark");
  });

  it("lets a menu follow a theme's own palette, and inverts again after going back", () => {
    if (palette === undefined) throw new Error("no paper theme");
    applyThemeVars(root, palette);
    expect(invertedMenuClass()).toBe("");
    applyThemeVars(root, DECK_LIGHT_THEME);
    expect(invertedMenuClass()).toBe("dark");
  });
});
