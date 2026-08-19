/**
 * ESLint's stylish output is the one grammar in this repo that needs TWO lines
 * to name a place (design §2.3), which is why it lives in its own module and
 * was sequenced last:
 *
 *     src/foo.ts
 *       12:5   error    'x' is assigned a value but never used   no-unused-vars
 *       20:1   warning  Missing semicolon                        semi
 *
 * The header already links today — it is an ordinary path candidate. What this
 * adds is the jump: a click on `12:5` opens THAT file at that position, which
 * means the row has to find its own header by walking up the buffer.
 *
 * The walk stops at the first line that is not a position row, because that is
 * exactly what a header is in this format: the thing the rows hang under. It is
 * capped so a screen full of numbers cannot turn one hover into a buffer scan.
 */
import { readLogicalLine, type BufferLike } from "./logical-line";

/** How far up one hover may look. A file with more findings than this on
 * screen at once is not a case worth paying a longer walk for. */
export const MAX_HEADER_SCAN = 50;

export interface PositionRow {
  readonly line: number;
  readonly col: number;
  /** Index of the `12:5` token in the row's text, inclusive. */
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
}

/**
 * ESLint indents every finding and follows the position with a severity word.
 * Both are required: `12:5` alone appears in ordinary prose and in timestamps,
 * and linkifying it there would put a link on text that names no file.
 */
const POSITION_ROW = /^(\s+)(\d{1,7}):(\d{1,7})(\s+)(error|warning)\b/u;

function toInt(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The position a finding row names, or null when the line is not one. */
export function matchPositionRow(text: string): PositionRow | null {
  const m = POSITION_ROW.exec(text);
  if (m === null) {
    return null;
  }
  const line = toInt(m[2]);
  const col = toInt(m[3]);
  if (line === null || col === null) {
    return null;
  }
  const start = (m[1] ?? "").length;
  return {
    line,
    col,
    start,
    end: start + (m[2] ?? "").length + 1 + (m[3] ?? "").length,
  };
}

/**
 * The text of the header a finding row belongs to, or null.
 *
 * Returns the RAW line rather than a path: the caller already owns candidate
 * extraction and path resolution, and returning a string keeps this module
 * free of both. That string is also what the caller keys its cache by — see
 * the cache note in `link-provider.ts`.
 */
export function eslintHeaderText(
  buffer: BufferLike,
  cols: number,
  row: number,
  maxRows: number = MAX_HEADER_SCAN,
): string | null {
  let top = readLogicalLine(buffer, cols, row)?.spans[0]?.y ?? row;
  for (let step = 0; step < maxRows; step += 1) {
    if (top === 0) {
      return null;
    }
    const above = readLogicalLine(buffer, cols, top - 1);
    if (above === null) {
      return null;
    }
    if (matchPositionRow(above.text) === null) {
      // A blank line separates one file's block from the next, so an empty
      // line is the end of the search rather than the header: crossing it
      // would hand this row the PREVIOUS file's name.
      return above.text.trim() === "" ? null : above.text;
    }
    top = above.spans[0]?.y ?? top - 1;
  }
  return null;
}
