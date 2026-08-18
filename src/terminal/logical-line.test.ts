import { describe, expect, it } from 'vitest';
import { readLogicalLine, type BufferLike } from './logical-line';

/** Builds a buffer from rows of text; a row prefixed `>` is a wrap of the one above. */
function fakeBuffer(rows: readonly string[], cols: number): BufferLike {
  const lines = rows.map((row) => ({
    isWrapped: row.startsWith('>'),
    // One cell holds one code point — an emoji occupies a single cell even
    // though it is two UTF-16 code units, which is the case that matters here.
    cells: Array.from(row.startsWith('>') ? row.slice(1) : row),
  }));
  return {
    getLine(y) {
      const line = lines[y];
      if (line === undefined) {
        return undefined;
      }
      return {
        isWrapped: line.isWrapped,
        getCell(x) {
          if (x >= cols) {
            return undefined;
          }
          const char = line.cells[x] ?? ' ';
          const wide = char === '#' || char.length > 1;
          return {
            getChars: () => (char === ' ' ? '' : char),
            // A `#` (and any astral char) owns the next cell too.
            getWidth: () => (wide ? 2 : 1),
          };
        },
      };
    },
  };
}

describe('readLogicalLine', () => {
  it('reads a single row and maps every character to its cell', () => {
    const line = readLogicalLine(fakeBuffer(['ab'], 2), 2, 0);
    expect(line?.text).toBe('ab');
    expect(line?.spans).toEqual([
      { x: 0, y: 0, width: 1 },
      { x: 1, y: 0, width: 1 },
    ]);
  });

  it('joins the rows a line wrapped onto', () => {
    const line = readLogicalLine(fakeBuffer(['ab', '>cd'], 2), 2, 0);
    expect(line?.text).toBe('abcd');
    expect(line?.spans[2]).toEqual({ x: 0, y: 1, width: 1 });
  });

  it('walks back up to the start of a wrapped line', () => {
    const line = readLogicalLine(fakeBuffer(['ab', '>cd'], 2), 2, 1);
    expect(line?.text).toBe('abcd');
  });

  it('stops at the next unwrapped row', () => {
    const line = readLogicalLine(fakeBuffer(['ab', 'cd'], 2), 2, 0);
    expect(line?.text).toBe('ab');
  });

  it('keeps blank cells as spaces so indices stay aligned', () => {
    const line = readLogicalLine(fakeBuffer(['a b'], 3), 3, 0);
    expect(line?.text).toBe('a b');
    expect(line?.spans[2]).toEqual({ x: 2, y: 0, width: 1 });
  });

  it('records the cell width of a wide character', () => {
    const line = readLogicalLine(fakeBuffer(['#b'], 2), 2, 0);
    expect(line?.spans[0]).toEqual({ x: 0, y: 0, width: 2 });
  });

  it('keeps one span per code unit so an emoji does not shift the cells', () => {
    // 🚀 is one cell but two UTF-16 code units — the regex that consumes the
    // text reports code-unit indices, so the spans have to match it.
    const line = readLogicalLine(fakeBuffer(['🚀ab'], 3), 3, 0);
    expect(line).not.toBeNull();
    expect(line!.text).toBe('🚀ab');
    expect(line!.spans).toHaveLength(line!.text.length);
    // Both halves of the surrogate pair point at the emoji's own cell...
    expect(line?.spans[0]).toEqual({ x: 0, y: 0, width: 2 });
    expect(line?.spans[1]).toEqual({ x: 0, y: 0, width: 2 });
    // ...and "a" still lands on cell 1, the way it does without the emoji.
    expect(line?.spans[line!.text.indexOf('a')]).toEqual({
      x: 1,
      y: 0,
      width: 1,
    });
  });

  it('returns null past the end of the buffer', () => {
    expect(readLogicalLine(fakeBuffer(['ab'], 2), 2, 5)).toBeNull();
  });

  it('still covers the hovered row on a logical line longer than the cap', () => {
    // 60 wrapped rows: the backward walk clamps well above the hovered row, so
    // a window of exactly MAX_ROWS starting there would stop short of it.
    const rows = ['a', ...Array.from({ length: 59 }, (_, i) => `>${i % 10}`)];
    const hovered = 55;
    const line = readLogicalLine(fakeBuffer(rows, 1), 1, hovered);
    expect(line).not.toBeNull();
    expect(line!.spans.some((span) => span.y === hovered)).toBe(true);
  });
});
