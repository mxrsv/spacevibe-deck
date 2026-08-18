import { describe, expect, it } from 'vitest';
import { hexFromUnitRgb, normalizeHex } from './normalize-hex';

describe('normalizeHex', () => {
  it.each([
    ['#1D1F21', '#1d1f21'],
    ['1d1f21', '#1d1f21'],
    ['0x1d1f21', '#1d1f21'],
    ['  #1d1f21  ', '#1d1f21'],
    ['#abc', '#aabbcc'],
  ])('reads %s as %s', (raw, expected) => {
    expect(normalizeHex(raw)).toBe(expected);
  });

  it('drops the alpha channel', () => {
    // An 8-digit value would reach `--bg`, and every derived chrome colour is
    // a mix against an opaque background — a translucent one shows the
    // desktop through the sidebar.
    expect(normalizeHex('#1d1f2180')).toBe('#1d1f21');
  });

  it.each(['', 'not a colour', '#12345', 'rgb(1,2,3)', '#gggggg'])('refuses %o', (raw) => {
    expect(normalizeHex(raw)).toBe(null);
  });
});

describe('hexFromUnitRgb', () => {
  it("converts iTerm2's 0–1 channels", () => {
    expect(hexFromUnitRgb(0, 0, 0)).toBe('#000000');
    expect(hexFromUnitRgb(1, 1, 1)).toBe('#ffffff');
    expect(hexFromUnitRgb(0.5, 0.25, 0.75)).toBe('#8040bf');
  });

  it('clamps out-of-range channels to six digits', () => {
    // A picker-written plist can carry 1.0000001; unclamped that is 256, which
    // formats as "100" and produces a seven-character string.
    expect(hexFromUnitRgb(1.004, -0.2, 0.5)).toBe('#ff0080');
  });
});
