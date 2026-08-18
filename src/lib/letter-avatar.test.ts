import { describe, expect, it } from 'vitest';
import { letterAvatar } from './letter-avatar';
import { TAB_DOT_COLORS } from './tab-colors';

describe('letterAvatar', () => {
  it('uses the first alphanumeric letter, uppercased', () => {
    expect(letterAvatar('spacevibe-workspace', '/x').letter).toBe('S');
    expect(letterAvatar('  stackgrid', '/x').letter).toBe('S');
    expect(letterAvatar('42-crunch', '/x').letter).toBe('4');
  });

  it('falls back to ? when there is no alphanumeric character', () => {
    expect(letterAvatar('···', '/x').letter).toBe('?');
    expect(letterAvatar('', '/x').letter).toBe('?');
  });

  it('picks a color from the theme palette, stable per seed', () => {
    const a = letterAvatar('repo', '/Users/k/dev/repo');
    const b = letterAvatar('repo', '/Users/k/dev/repo');
    expect(a.color).toBe(b.color);
    expect(TAB_DOT_COLORS).toContain(a.color);
  });

  it('varies the color across different seeds', () => {
    const colors = new Set(
      ['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h'].map((seed) => letterAvatar('x', seed).color),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
