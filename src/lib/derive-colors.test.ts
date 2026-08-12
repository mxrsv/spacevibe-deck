import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deriveChromeColors,
  luminance,
  mixHex,
} from "./derive-colors";
import { THEME_PRESETS } from "../settings/themes";

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
    expect(contrastRatio("#16161e", "#c0caf5")).toBeCloseTo(
      contrastRatio("#c0caf5", "#16161e"),
      5,
    );
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

describe("deriveChromeColors", () => {
  it("mixes toward white on dark backgrounds, black on light ones", () => {
    expect(deriveChromeColors("#16161e", "#c0caf5").tone).toBe("#ffffff");
    expect(deriveChromeColors("#ffffff", "#333333").tone).toBe("#000000");
  });

  it("emits alpha hairlines from the foreground", () => {
    const chrome = deriveChromeColors("#16161e", "#c0caf5");
    expect(chrome.hair).toBe("rgba(192, 202, 245, 0.12)");
    expect(chrome.hairStrong).toBe("rgba(192, 202, 245, 0.2)");
  });

  /**
   * The seam ladder is a set of RELATIONSHIPS, not four hex literals: what was
   * wrong before was never a particular value, it was that a structural line
   * sat further from its surface than the surface sat from its neighbour. A
   * literal assertion would pass the day someone reintroduces exactly that.
   */
  describe("the seam ladder", () => {
    const lum = (color: string): number => luminance(color);

    it("puts a shell seam BELOW the surface it edges, on every preset", () => {
      for (const preset of THEME_PRESETS) {
        const bg = preset.theme.background ?? "#16161e";
        const fg = preset.theme.foreground ?? "#c0caf5";
        const c = deriveChromeColors(bg, fg);
        const towardChrome = lum(c.chrome1) - lum(bg);
        const towardSeam = lum(c.seamRecessed) - lum(bg);
        // Between the two surfaces, and nearer the darker one — a gutter, not
        // a stroke laid on top.
        expect(towardSeam).toBeGreaterThan(0);
        expect(towardSeam).toBeLessThan(towardChrome);
      }
    });

    it("keeps the surface step louder than the seam that marks it", () => {
      for (const preset of THEME_PRESETS) {
        const bg = preset.theme.background ?? "#16161e";
        const fg = preset.theme.foreground ?? "#c0caf5";
        const c = deriveChromeColors(bg, fg);
        const step = Math.abs(lum(c.chrome1) - lum(bg));
        const seam = Math.abs(lum(c.seamRecessed) - lum(c.chrome1));
        expect(seam).toBeLessThan(step);
      }
    });

    it("raises a floating frame above the surface it frames", () => {
      const c = deriveChromeColors("#16161e", "#c0caf5");
      expect(lum(c.seamRaised)).toBeGreaterThan(lum(c.chrome2));
    });

    it("keeps the in-surface divider alpha, so it adapts to its ground", () => {
      const c = deriveChromeColors("#16161e", "#c0caf5");
      expect(c.seamDivider).toBe("rgba(255, 255, 255, 0.03)");
      expect(deriveChromeColors("#ffffff", "#333333").seamDivider).toBe(
        "rgba(0, 0, 0, 0.03)",
      );
    });
  });

  // The spec's contrast floors — the app-wide standard. Every preset plus
  // the known-bad overrides must pass.
  const cases: Array<{ label: string; bg: string; fg: string }> = [
    ...THEME_PRESETS.map((preset) => ({
      label: preset.label,
      bg: preset.theme.background,
      fg: preset.theme.foreground,
    })),
    // Tokyo Night comment color used as fg override (1.02:1 raw on inputs)
    { label: "low-contrast fg override", bg: "#1a1b26", fg: "#565f89" },
    // Light background override that broke the old white-mix chrome
    { label: "light bg override", bg: "#ffffff", fg: "#c0caf5" },
    { label: "light bg, light fg", bg: "#fafafa", fg: "#e0e0e0" },
  ];

  for (const { label, bg, fg } of cases) {
    it(`meets all contrast floors for ${label}`, () => {
      const c = deriveChromeColors(bg, fg);
      // Checked against EVERY surface, not just chrome1: the panel body is
      // chrome2 and the active row is tabActiveBg, and both are lighter.
      const surfaces = [c.chrome1, c.chrome2, c.tabActiveBg];
      for (const surface of [c.inputBg, ...surfaces]) {
        expect(contrastRatio(c.textPrimary, surface)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      for (const surface of surfaces) {
        expect(contrastRatio(c.textMuted, surface)).toBeGreaterThanOrEqual(5.5);
        // 4.5, not 3 — this token styles 10.5px text (WCAG AA "normal").
        expect(contrastRatio(c.textFaint, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`keeps the text ladder ordered for ${label}`, () => {
      // Regression guard: deriving each tone from `bg` independently used to
      // inverse the ladder on a dim-foreground theme — textMuted came out
      // LOUDER than textPrimary. primary >= muted >= faint, on every surface.
      const c = deriveChromeColors(bg, fg);
      for (const surface of [c.chrome1, c.chrome2, c.tabActiveBg]) {
        const primary = contrastRatio(c.textPrimary, surface);
        const muted = contrastRatio(c.textMuted, surface);
        const faint = contrastRatio(c.textFaint, surface);
        expect(primary).toBeGreaterThanOrEqual(muted);
        expect(muted).toBeGreaterThanOrEqual(faint);
      }
    });
  }

  it("keeps the three tones visually distinct on every preset", () => {
    // The floors are stacked (7 / 5.5 / 4.5) so the label/description
    // hierarchy in a config row survives; guard they never converge.
    for (const preset of THEME_PRESETS) {
      const c = deriveChromeColors(
        preset.theme.background,
        preset.theme.foreground,
      );
      expect(new Set([c.textPrimary, c.textMuted, c.textFaint]).size).toBe(3);
    }
  });

  it("keeps a high-contrast fg unchanged as textPrimary", () => {
    // Tokyo Night fg is already >> 4.5:1 on its surfaces — no raise needed
    expect(deriveChromeColors("#16161e", "#c0caf5").textPrimary).toBe(
      "#c0caf5",
    );
  });
});
