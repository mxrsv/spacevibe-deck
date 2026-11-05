import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deriveChromeColors,
  deriveRecipeTokens,
  luminance,
  mixHex,
} from "./derive-colors";
import { BUILT_IN_THEMES, DECK_DARK_THEME, DECK_LIGHT_THEME } from "../settings/built-in-themes";
import type { Theme } from "../settings/theme-schema";

describe("luminance", () => {
  it("is 1 for white and 0 for black", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBeCloseTo(0, 5);
  });

  it("is ~0.2158 for #808080", () => {
    expect(luminance("#808080")).toBeCloseTo(0.2158, 3);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#16161e", "#c0caf5")).toBeCloseTo(contrastRatio("#c0caf5", "#16161e"), 5);
  });
});

describe("mixHex", () => {
  it("returns base at 0 and target at 1", () => {
    expect(mixHex("#16161e", "#ffffff", 0)).toBe("#16161e");
    expect(mixHex("#16161e", "#ffffff", 1)).toBe("#ffffff");
  });

  it("mixes black and white to mid gray", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

const lum = (color: string): number => luminance(color);

/**
 * Distance travelled ALONG the tone, not up the luminance axis.
 *
 * `tone` flips with the type: white on a dark theme, black on a light one.
 * Written as a raw luminance difference the ladder reads backwards on a light
 * theme — every surface sits BELOW its background there — and an assertion
 * would fail a palette that is in fact perfectly ordered.
 */
const towardTone = (theme: Theme, color: string): number =>
  theme.type === "dark" ? lum(color) - lum(theme.ui.bg) : lum(theme.ui.bg) - lum(color);

describe("deriveChromeColors", () => {
  it("mixes toward white on dark themes, black on light ones", () => {
    expect(deriveChromeColors(DECK_DARK_THEME).tone).toBe("#ffffff");
    expect(deriveChromeColors(DECK_LIGHT_THEME).tone).toBe("#000000");
  });

  it("emits alpha hairlines from the tone, not the foreground", () => {
    // A line inside a surface belongs to the background ladder for the same
    // reason a seam does (DL-2.3).
    const dark = deriveChromeColors(DECK_DARK_THEME);
    expect(dark.hair).toBe("rgba(255, 255, 255, 0.12)");
    expect(dark.hairStrong).toBe("rgba(255, 255, 255, 0.2)");
    const light = deriveChromeColors(DECK_LIGHT_THEME);
    expect(light.hair).toBe("rgba(0, 0, 0, 0.12)");
    expect(light.hairStrong).toBe("rgba(0, 0, 0, 0.2)");
  });

  it("is a function of the type and the two lowest surfaces only", () => {
    // Every other declared token can move without moving a wash or a seam.
    const recoloured: Theme = {
      ...DECK_DARK_THEME,
      ui: { ...DECK_DARK_THEME.ui, fg: "#c0caf5", accent: "#ff00ff", "chrome-1": "#333333" },
    };
    expect(deriveChromeColors(recoloured)).toEqual(deriveChromeColors(DECK_DARK_THEME));
  });

  // Literals, so the default theme's selection wash and frames cannot move as a
  // side effect of a formula change.
  it("keeps Deck Dark's washes and frames where they were reviewed", () => {
    const chrome = deriveChromeColors(DECK_DARK_THEME);
    expect(chrome.tabActiveBg).toBe("#2c2c2c");
    expect(chrome.seamRaised).toBe("#292929");
    expect(chrome.seamRecessed).toBe("#0f0f0f");
    expect(chrome.sidebarSeam).toBe("#0f0f0f");
  });

  describe("the focused stage surface", () => {
    it.each(BUILT_IN_THEMES)(
      "keeps both sidebar tokens distinct from the stage on $id",
      (theme) => {
        const chrome = deriveChromeColors(theme);
        expect(theme.ui["sidebar-bg"]).not.toBe(theme.ui.bg);
        expect(chrome.sidebarSeam).not.toBe(theme.ui.bg);
        expect(chrome.sidebarSeam).not.toBe(theme.ui["sidebar-bg"]);
      },
    );

    /**
     * DL-18.7: on a dark theme the side columns rise off the stage, on a light
     * one they recede below it. Signed by type rather than "distinct", because
     * "distinct" alone would pass a theme that quietly swings the sidebar back
     * under the stage.
     */
    it.each(BUILT_IN_THEMES)("raises $id's sidebar toward the tone", (theme) => {
      expect(towardTone(theme, theme.ui["sidebar-bg"])).toBeGreaterThan(0);
    });

    /**
     * The dark chrome ladder stacks on the sidebar: a popover and the column
     * behind it must not read as one smudged plane.
     */
    it.each(BUILT_IN_THEMES.filter((theme) => theme.type === "dark"))(
      "stacks every chrome surface of $id above the sidebar",
      (theme) => {
        const { ui } = theme;
        const ladder = [
          ui["input-bg"],
          ui["sidebar-bg"],
          ui["chrome-1"],
          ui["chrome-2"],
          deriveChromeColors(theme).tabActiveBg,
        ].map(lum);
        for (let step = 1; step < ladder.length; step += 1) {
          expect(ladder[step]).toBeGreaterThan(ladder[step - 1]);
        }
        // The input recedes toward the stage but never falls into it.
        expect(lum(ui["input-bg"])).toBeGreaterThan(lum(ui.bg));
      },
    );
  });

  /**
   * The seam ladder is a set of RELATIONSHIPS, not four hex literals: what was
   * wrong before was never a particular value, it was that a structural line
   * sat further from its surface than the surface sat from its neighbour.
   */
  describe("the seam ladder", () => {
    it.each(BUILT_IN_THEMES)("puts a shell seam BELOW the surface it edges on $id", (theme) => {
      const c = deriveChromeColors(theme);
      const towardSeam = towardTone(theme, c.seamRecessed);
      // Between the two surfaces, and nearer the stage — a gutter, not a stroke
      // laid on top.
      expect(towardSeam).toBeGreaterThan(0);
      expect(towardSeam).toBeLessThan(towardTone(theme, theme.ui["chrome-1"]));
    });

    it.each(BUILT_IN_THEMES)(
      "keeps the surface step louder than the seam that marks it on $id",
      (theme) => {
        const c = deriveChromeColors(theme);
        const step = Math.abs(lum(theme.ui["chrome-1"]) - lum(theme.ui.bg));
        const seam = Math.abs(lum(c.seamRecessed) - lum(theme.ui["chrome-1"]));
        expect(seam).toBeLessThan(step);
      },
    );

    it.each(BUILT_IN_THEMES)(
      "raises a floating frame above the panel it frames on $id",
      (theme) => {
        const c = deriveChromeColors(theme);
        expect(towardTone(theme, c.seamRaised)).toBeGreaterThan(
          towardTone(theme, theme.ui["chrome-2"]),
        );
      },
    );

    it("keeps the in-surface divider alpha, so it adapts to its ground", () => {
      expect(deriveChromeColors(DECK_DARK_THEME).seamDivider).toBe("rgba(255, 255, 255, 0.12)");
      expect(deriveChromeColors(DECK_LIGHT_THEME).seamDivider).toBe("rgba(0, 0, 0, 0.12)");
    });

    it("draws the pane split one step louder than the strip's edge", () => {
      expect(deriveChromeColors(DECK_DARK_THEME).seamSplit).toBe("rgba(255, 255, 255, 0.2)");
      expect(deriveChromeColors(DECK_LIGHT_THEME).seamSplit).toBe("rgba(0, 0, 0, 0.2)");
    });
  });

  describe("the interaction-state pair (DL-21)", () => {
    // The rule §21 exists to prevent is one declaration serving both states:
    // hovering an unselected row painted "selected".
    it.each(BUILT_IN_THEMES)("keeps hover quieter than selection on $id", (theme) => {
      const c = deriveChromeColors(theme);
      expect(c.stateHoverBg).not.toBe(c.tabActiveBg);
      expect(towardTone(theme, c.tabActiveBg)).toBeGreaterThan(
        towardTone(theme, theme.ui["chrome-2"]),
      );
    });

    it("mixes the hover wash from the tone, not the foreground", () => {
      expect(deriveChromeColors(DECK_DARK_THEME).stateHoverBg).toBe("rgba(255, 255, 255, 0.06)");
      expect(deriveChromeColors(DECK_LIGHT_THEME).stateHoverBg).toBe("rgba(0, 0, 0, 0.06)");
    });
  });
});

describe("deriveRecipeTokens", () => {
  const graphite = BUILT_IN_THEMES.find((theme) => theme.id === "graphite") as Theme;

  it("yields the mock's grounds and focus wash for graphite and Deck Light (RCP-2)", () => {
    const dark = deriveRecipeTokens(graphite);
    expect(dark["--tab-active-focus-bg"]).toBe("#4b4e51");
    expect(dark["--popover-bg"]).toBe(graphite.ui["sidebar-bg"]);
    expect(dark["--card-bg"]).toBe(graphite.ui["chrome-1"]);
    expect(dark["--selection-bg"]).toBe(graphite.terminal.selectionBackground);
    const light = deriveRecipeTokens(DECK_LIGHT_THEME);
    expect(light["--tab-active-focus-bg"]).toBe("#bfc0c2");
    expect(light["--popover-bg"]).toBe("#ffffff");
    expect(light["--well-bg"]).toBe("#ffffff");
    expect(light["--card-bg"]).toBe(DECK_LIGHT_THEME.ui.bg);
  });

  it("keeps hover under selected inside a menu on every built-in theme", () => {
    for (const theme of BUILT_IN_THEMES) {
      const tokens = deriveRecipeTokens(theme);
      const selected = deriveChromeColors(theme).tabActiveBg;
      expect(tokens["--popover-bg"], theme.id).not.toBe(selected);
      expect(tokens["--tab-active-focus-bg"], theme.id).not.toBe(selected);
    }
  });

  it("edges a dark elevation with the hairline and leaves a light one shadow only (RCP-11)", () => {
    const dark = deriveRecipeTokens(graphite);
    const light = deriveRecipeTokens(DECK_LIGHT_THEME);
    for (const level of ["--elev-1", "--elev-2", "--elev-3"]) {
      expect(dark[level]).toContain("inset 0 0 0 1px");
      expect(light[level]).not.toContain("inset");
    }
    expect(dark["--panel-frame"]).toBe("transparent");
    expect(light["--panel-frame"]).toBe(deriveChromeColors(DECK_LIGHT_THEME).seamRaised);
  });
});
