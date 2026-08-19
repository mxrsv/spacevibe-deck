import { describe, expect, it } from "vitest";
import type { BufferLike } from "./logical-line";
import { eslintHeaderText, matchPositionRow } from "./eslint-positions";

/** Rows of plain text, one buffer line each — no wrapping. */
function fakeBuffer(rows: readonly string[]): {
  readonly buffer: BufferLike;
  readonly cols: number;
} {
  const cols = Math.max(1, ...rows.map((row) => row.length));
  return {
    cols,
    buffer: {
      getLine(y: number) {
        const row = rows[y];
        if (row === undefined) {
          return undefined;
        }
        return {
          isWrapped: false,
          getCell(x: number) {
            if (x >= row.length) {
              return undefined;
            }
            return { getChars: () => row[x], getWidth: () => 1 };
          },
        };
      },
    },
  };
}

describe("matchPositionRow", () => {
  it("reads an ESLint finding row", () => {
    const row = matchPositionRow(
      "  12:5   error  'x' is assigned a value but never used  no-unused-vars",
    );
    expect(row).toMatchObject({ line: 12, col: 5, start: 2, end: 6 });
  });

  it("reads a warning row too", () => {
    expect(
      matchPositionRow("   3:1  warning  Missing semicolon  semi"),
    ).toMatchObject({ line: 3, col: 1 });
  });

  it("refuses a bare position with no severity", () => {
    // `12:5` on its own appears in prose and timestamps; a link there would
    // name no file at all.
    expect(matchPositionRow("  12:5  something")).toBeNull();
    expect(matchPositionRow("12:5  error  x")).toBeNull();
  });

  it("refuses a header line", () => {
    expect(matchPositionRow("src/foo.ts")).toBeNull();
  });
});

describe("eslintHeaderText", () => {
  const REPORT = [
    "src/foo.ts",
    "  12:5   error    'x' is unused  no-unused-vars",
    "  20:1   warning  Missing semi   semi",
    "",
    "src/bar.ts",
    "  12:5   error    'x' is unused  no-unused-vars",
  ];

  it("walks past sibling rows to the header", () => {
    const { buffer, cols } = fakeBuffer(REPORT);
    expect(eslintHeaderText(buffer, cols, 2)).toBe("src/foo.ts");
  });

  it("gives the SECOND block's row the second header", () => {
    // The row's text is byte-identical to row 1's. This is the case the
    // provider's cache would otherwise get wrong (design §2.3).
    const { buffer, cols } = fakeBuffer(REPORT);
    expect(eslintHeaderText(buffer, cols, 5)).toBe("src/bar.ts");
  });

  it("stops at a blank line rather than crossing into the block above", () => {
    const { buffer, cols } = fakeBuffer([
      "src/foo.ts",
      "",
      "  12:5   error  x  rule",
    ]);
    expect(eslintHeaderText(buffer, cols, 2)).toBeNull();
  });

  it("answers null at the top of the buffer", () => {
    const { buffer, cols } = fakeBuffer(["  12:5   error  x  rule"]);
    expect(eslintHeaderText(buffer, cols, 0)).toBeNull();
  });

  it("gives up rather than scanning forever", () => {
    const rows = [
      "src/foo.ts",
      ...Array.from({ length: 60 }, () => "  1:1  error  x  rule"),
    ];
    const { buffer, cols } = fakeBuffer(rows);
    expect(eslintHeaderText(buffer, cols, rows.length - 1, 5)).toBeNull();
  });
});
