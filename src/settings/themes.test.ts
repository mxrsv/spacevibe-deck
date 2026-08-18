import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings-schema';
import { getPreset, resolveTheme, THEME_PRESETS } from './themes';

describe('resolveTheme', () => {
  // xterm defaults overviewRulerBorder to #ffffff — a white hairline next to
  // the scrollbar once overviewRuler.width is set (see terminal/pane.ts).
  it.each(THEME_PRESETS)('hides the overview ruler border on $id', (preset) => {
    const theme = resolveTheme({ ...DEFAULT_SETTINGS, themeId: preset.id });

    expect(theme.overviewRulerBorder).toBe(theme.background);
  });

  it('follows a background color override', () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: '#101014' },
    });

    expect(theme.background).toBe('#101014');
    expect(theme.overviewRulerBorder).toBe('#101014');
  });

  it('falls back to the first preset for an unknown theme id', () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      themeId: 'does-not-exist',
    });

    expect(theme.background).toBe(THEME_PRESETS[0].theme.background);
    expect(theme.overviewRulerBorder).toBe(theme.background);
  });

  it('lets a color override win over the preset', () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      themeId: 'tokyo-night',
      colorOverrides: { foreground: '#abcdef' },
    });

    expect(theme.foreground).toBe('#abcdef');
    expect(theme.background).toBe(getPreset('tokyo-night').theme.background);
  });

  it('pins cursorAccent to the resolved background', () => {
    const theme = resolveTheme({
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: '#101014' },
    });

    expect(theme.cursorAccent).toBe('#101014');
  });
});
