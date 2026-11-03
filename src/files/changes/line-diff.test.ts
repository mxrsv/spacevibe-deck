import { describe, expect, it } from "vitest";
import { diffLines, numberLines } from "./line-diff";

const text = (lines: readonly string[]): string => `${lines.join("\n")}\n`;
const numbered = (count: number): string[] => Array.from({ length: count }, (_, i) => `l${i + 1}`);
const shape = (diff: ReturnType<typeof diffLines>): string[][] =>
  diff.hunks.map((hunk) =>
    hunk.lines.map((line) => `${{ add: "+", del: "-", context: " " }[line.kind]}${line.text}`),
  );

describe("diffLines", () => {
  it("yields no hunks for identical texts, whatever the line endings or final newline", () => {
    expect(diffLines("a\nb\n", "a\nb\n").hunks).toEqual([]);
    expect(diffLines("a\r\nb\r\n", "a\nb").hunks).toEqual([]);
    expect(diffLines("", "").hunks).toEqual([]);
  });

  it("shows an insert-only change with its context", () => {
    const diff = diffLines(text(["a", "b", "c"]), text(["a", "b", "new", "c"]));
    expect(shape(diff)).toEqual([[" a", " b", "+new", " c"]]);
    expect(diff.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 });
  });

  it("shows a delete-only change", () => {
    const diff = diffLines(text(["a", "b", "c"]), text(["a", "c"]));
    expect(shape(diff)).toEqual([[" a", "-b", " c"]]);
    expect(diff.hunks[0]).toMatchObject({ oldLines: 3, newLines: 2 });
  });

  it("shows a replaced line as a removal then an addition", () => {
    const diff = diffLines(text(["a", "b", "c"]), text(["a", "B", "c"]));
    expect(shape(diff)).toEqual([[" a", "-b", "+B", " c"]]);
  });

  it("reads an added file as all additions and a deleted file as all removals", () => {
    const added = diffLines("", text(["x", "y"]));
    expect(shape(added)).toEqual([["+x", "+y"]]);
    expect(added.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 });
    const deleted = diffLines(text(["x", "y"]), "");
    expect(shape(deleted)).toEqual([["-x", "-y"]]);
    expect(deleted.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0 });
  });

  it("keeps two distant changes as two hunks of three lines of context", () => {
    const before = numbered(30);
    const after = before.map((line) => (line === "l5" || line === "l25" ? `${line}!` : line));
    const diff = diffLines(text(before), text(after));
    expect(diff.hunks).toHaveLength(2);
    expect(shape(diff)[0]).toEqual([" l2", " l3", " l4", "-l5", "+l5!", " l6", " l7", " l8"]);
    expect(diff.hunks[1]).toMatchObject({ oldStart: 22, newStart: 22, oldLines: 7, newLines: 7 });
  });

  it("merges changes whose context touches into one hunk", () => {
    const before = numbered(12);
    const after = before.map((line) => (line === "l3" || line === "l8" ? `${line}!` : line));
    expect(diffLines(text(before), text(after)).hunks).toHaveLength(1);
  });

  it("finds the shortest script across a shuffled middle", () => {
    const diff = diffLines(text(["a", "b", "c", "d", "e"]), text(["a", "c", "b", "d", "e"]));
    const changed = diff.hunks[0].lines.filter((line) => line.kind !== "context");
    expect(changed).toHaveLength(2);
  });

  it("answers tooLarge past the cap instead of drawing a huge rewrite", () => {
    const before = text(numbered(50));
    const after = text(numbered(50).map((line) => `${line}x`));
    expect(diffLines(before, after, 3, 20)).toEqual({ hunks: [], tooLarge: true });
    expect(diffLines("", before, 3, 20)).toEqual({ hunks: [], tooLarge: true });
    expect(diffLines(before, after, 3, 100).tooLarge).toBe(false);
  });
});

describe("numberLines", () => {
  const numbers = (diff: ReturnType<typeof diffLines>, hunk = 0) =>
    numberLines(diff.hunks[hunk]).map((line) => [line.oldLine, line.newLine]);

  it("numbers context on both sides, a removal on the old side and an addition on the new", () => {
    const diff = diffLines(
      text(numbered(10)),
      text([...numbered(5), "new", ...numbered(10).slice(6)]),
    );
    // l6 became `new`: three lines of context either side, from line 3.
    expect(numbers(diff)).toEqual([
      [3, 3],
      [4, 4],
      [5, 5],
      [6, null],
      [null, 6],
      [7, 7],
      [8, 8],
      [9, 9],
    ]);
  });

  it("numbers an added file from 1 on the new side only, and a deleted one on the old side", () => {
    expect(numbers(diffLines("", text(["x", "y"])))).toEqual([
      [null, 1],
      [null, 2],
    ]);
    expect(numbers(diffLines(text(["x", "y"]), ""))).toEqual([
      [1, null],
      [2, null],
    ]);
  });

  it("keeps counting across a second hunk from its own start", () => {
    const after = numbered(30).map((line, i) => (i === 1 || i === 25 ? `${line}!` : line));
    const diff = diffLines(text(numbered(30)), text(after));
    expect(diff.hunks).toHaveLength(2);
    expect(numbers(diff, 1)[0]).toEqual([23, 23]);
    expect(numberLines(diff.hunks[1]).find((line) => line.kind === "add")?.newLine).toBe(26);
  });
});
