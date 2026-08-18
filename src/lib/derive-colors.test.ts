import { describe, expect, it } from 'vitest';
import {
  checkChromeTextContrast,
  contrastRatio,
  deriveChromeColors,
  luminance,
  mixHex,
} from './derive-colors';
import { THEME_PRESETS } from '../settings/themes';

describe('luminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });

  it('is ~0.2158 for #808080', () => {
    expect(luminance('#808080')).toBeCloseTo(0.2158, 3);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#16161e', '#c0caf5')).toBeCloseTo(contrastRatio('#c0caf5', '#16161e'), 5);
  });
});

describe('mixHex', () => {
  it('returns base at 0 and target at 1', () => {
    expect(mixHex('#16161e', '#ffffff', 0)).toBe('#16161e');
    expect(mixHex('#16161e', '#ffffff', 1)).toBe('#ffffff');
  });

  it('mixes black and white to mid gray', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('deriveChromeColors', () => {
  it('mixes toward white on dark backgrounds, black on light ones', () => {
    expect(deriveChromeColors('#16161e', '#c0caf5').tone).toBe('#ffffff');
    expect(deriveChromeColors('#ffffff', '#333333').tone).toBe('#000000');
  });

  it('emits alpha hairlines from the tone, not the foreground', () => {
    // A line inside a surface belongs to the background ladder for the same
    // reason a seam does (DL-2.3). The fg below is strongly tinted on purpose,
    // so a foreground mix would show up in the assertion rather than being a
    // matter of taste.
    const chrome = deriveChromeColors('#16161e', '#c0caf5');
    expect(chrome.hair).toBe('rgba(255, 255, 255, 0.12)');
    expect(chrome.hairStrong).toBe('rgba(255, 255, 255, 0.2)');
    const light = deriveChromeColors('#ffffff', '#333333');
    expect(light.hair).toBe('rgba(0, 0, 0, 0.12)');
    expect(light.hairStrong).toBe('rgba(0, 0, 0, 0.2)');
  });

  describe('the focused stage surface', () => {
    it('keeps both sidebar tokens distinct from the stage on every preset', () => {
      for (const preset of THEME_PRESETS) {
        const bg = preset.theme.background ?? '#16161e';
        const fg = preset.theme.foreground ?? '#c0caf5';
        const chrome = deriveChromeColors(bg, fg);
        expect(chrome.sidebarBg).not.toBe(bg);
        expect(luminance(chrome.sidebarBg)).toBeLessThan(luminance(bg));
        expect(chrome.sidebarSeam).not.toBe(bg);
        expect(chrome.sidebarSeam).not.toBe(chrome.sidebarBg);
      }
    });

    it('preserves the distinction for light and pure-black overrides', () => {
      for (const [bg, fg] of [
        ['#ffffff', '#333333'],
        ['#000000', '#ffffff'],
      ] as const) {
        expect(deriveChromeColors(bg, fg).sidebarBg).not.toBe(bg);
      }
    });
  });

  /**
   * The seam ladder is a set of RELATIONSHIPS, not four hex literals: what was
   * wrong before was never a particular value, it was that a structural line
   * sat further from its surface than the surface sat from its neighbour. A
   * literal assertion would pass the day someone reintroduces exactly that.
   */
  describe('the seam ladder', () => {
    const lum = (color: string): number => luminance(color);

    it('puts a shell seam BELOW the surface it edges, on every preset', () => {
      for (const preset of THEME_PRESETS) {
        const bg = preset.theme.background ?? '#16161e';
        const fg = preset.theme.foreground ?? '#c0caf5';
        const c = deriveChromeColors(bg, fg);
        const towardChrome = lum(c.chrome1) - lum(bg);
        const towardSeam = lum(c.seamRecessed) - lum(bg);
        // Between the two surfaces, and nearer the darker one — a gutter, not
        // a stroke laid on top.
        expect(towardSeam).toBeGreaterThan(0);
        expect(towardSeam).toBeLessThan(towardChrome);
      }
    });

    it('keeps the surface step louder than the seam that marks it', () => {
      for (const preset of THEME_PRESETS) {
        const bg = preset.theme.background ?? '#16161e';
        const fg = preset.theme.foreground ?? '#c0caf5';
        const c = deriveChromeColors(bg, fg);
        const step = Math.abs(lum(c.chrome1) - lum(bg));
        const seam = Math.abs(lum(c.seamRecessed) - lum(c.chrome1));
        expect(seam).toBeLessThan(step);
      }
    });

    it('raises a floating frame above the surface it frames', () => {
      const c = deriveChromeColors('#16161e', '#c0caf5');
      expect(lum(c.seamRaised)).toBeGreaterThan(lum(c.chrome2));
    });

    it('keeps the in-surface divider alpha, so it adapts to its ground', () => {
      const c = deriveChromeColors('#16161e', '#c0caf5');
      expect(c.seamDivider).toBe('rgba(255, 255, 255, 0.12)');
      expect(deriveChromeColors('#ffffff', '#333333').seamDivider).toBe('rgba(0, 0, 0, 0.12)');
    });
  });

  describe('the interaction-state pair (DL-21)', () => {
    // The rule §21 exists to prevent is one declaration serving both states,
    // which is what the reviewed direction sheet shipped on the rail and the
    // settings nav: hovering an unselected row painted "selected".
    it('keeps hover quieter than selection on every preset', () => {
      const pairs: readonly (readonly [string, string])[] = [
        ...THEME_PRESETS.map(
          (preset) => [preset.theme.background, preset.theme.foreground] as const,
        ),
        ['#ffffff', '#333333'],
      ];
      for (const [bg, fg] of pairs) {
        const c = deriveChromeColors(bg, fg);
        expect(c.stateHoverBg).not.toBe(c.tabActiveBg);
      }
    });

    it('mixes the hover wash from the tone, not the foreground', () => {
      // From `fg` it would carry the terminal's text hue into a wash that is
      // meant to be colourless — the mistake DL-2.3 corrected for seams. The
      // fg below is a strongly tinted one (an imported theme's, since the
      // built-ins are neutral now), so a foreground mix would be visible in
      // the assertion rather than a matter of taste.
      expect(deriveChromeColors('#16161e', '#c0caf5').stateHoverBg).toBe(
        'rgba(255, 255, 255, 0.06)',
      );
      expect(deriveChromeColors('#ffffff', '#333333').stateHoverBg).toBe('rgba(0, 0, 0, 0.06)');
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
    { label: 'low-contrast fg override', bg: '#1a1b26', fg: '#565f89' },
    // Light background override that broke the old white-mix chrome
    { label: 'light bg override', bg: '#ffffff', fg: '#c0caf5' },
    { label: 'light bg, light fg', bg: '#fafafa', fg: '#e0e0e0' },
  ];

  for (const { label, bg, fg } of cases) {
    it(`meets all contrast floors for ${label}`, () => {
      const c = deriveChromeColors(bg, fg);
      // Checked against EVERY surface, not just chrome1: the panel body is
      // chrome2 and the active row is tabActiveBg, and both are lighter.
      const surfaces = [c.sidebarBg, c.chrome1, c.chrome2, c.tabActiveBg];
      for (const surface of [c.inputBg, ...surfaces]) {
        expect(contrastRatio(c.textPrimary, surface)).toBeGreaterThanOrEqual(8);
      }
      for (const surface of surfaces) {
        expect(contrastRatio(c.textMuted, surface)).toBeGreaterThanOrEqual(6);
        // 4.5, not 3 — this token styles 10.5px text (WCAG AA "normal").
        expect(contrastRatio(c.textFaint, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`keeps the text ladder ordered for ${label}`, () => {
      // Regression guard: deriving each tone from `bg` independently used to
      // inverse the ladder on a dim-foreground theme — textMuted came out
      // LOUDER than textPrimary. primary >= muted >= faint, on every surface.
      const c = deriveChromeColors(bg, fg);
      for (const surface of [c.sidebarBg, c.chrome1, c.chrome2, c.tabActiveBg]) {
        const primary = contrastRatio(c.textPrimary, surface);
        const muted = contrastRatio(c.textMuted, surface);
        const faint = contrastRatio(c.textFaint, surface);
        expect(primary).toBeGreaterThanOrEqual(muted);
        expect(muted).toBeGreaterThanOrEqual(faint);
      }
    });
  }

  it('keeps the three tones visually distinct on every preset', () => {
    // The floors are stacked (8 / 6 / 4.5) so the label/description
    // hierarchy in a config row survives; guard they never converge.
    for (const preset of THEME_PRESETS) {
      const c = deriveChromeColors(preset.theme.background, preset.theme.foreground);
      expect(new Set([c.textPrimary, c.textMuted, c.textFaint]).size).toBe(3);
    }
  });

  it("raises Tokyo Night's fg the few steps the 8:1 primary floor needs", () => {
    // Its raw contrast falls short of 8:1 on the two tightest surfaces
    // (7.84:1 on inputBg, 7.06:1 on tabActiveBg), so `ensureContrast` steps it
    // toward `tone` — an intentional consequence of the floor, not a
    // regression. The result is still neutral: the fg it starts from is now a
    // gray, so raising it toward white cannot reintroduce a hue.
    expect(deriveChromeColors('#16161e', '#cbcbcb').textPrimary).toBe('#d9d9d9');
  });

  it('keeps the built-in text ladder neutral', () => {
    // The whole point of the 2026-08-17 change: chrome ink must not carry the
    // palette's blue. Any residue comes from mixing back toward a tinted
    // background, which is a fraction of a percent, so hold every tone under a
    // 6% saturation ceiling rather than demanding a literal gray.
    const saturation = (hex: string): number => {
      const v = Number.parseInt(hex.slice(1), 16);
      const channels = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
      const max = Math.max(...channels);
      const min = Math.min(...channels);
      return max === 0 ? 0 : (max - min) / max;
    };
    for (const preset of THEME_PRESETS) {
      const c = deriveChromeColors(preset.theme.background, preset.theme.foreground);
      for (const tone of [c.textPrimary, c.textMuted, c.textFaint]) {
        expect(saturation(tone)).toBeLessThan(0.06);
      }
    }
  });
});

describe('checkChromeTextContrast', () => {
  it('accepts every built-in theme', () => {
    for (const preset of THEME_PRESETS) {
      expect(checkChromeTextContrast(preset.theme.background, preset.theme.foreground)).toEqual({
        ok: true,
      });
    }
  });

  it('rejects a mid-gray theme whose derived text cannot meet DL-3.5', () => {
    const result = checkChromeTextContrast('#777777', '#777777');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          token: 'textPrimary',
          surface: 'inputBg',
          required: 8,
        }),
      ]),
    );
    expect(result.reason).toContain('DL-3.5');
  });
});
