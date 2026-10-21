import { describe, expect, it } from "vitest";
import {
  commentLocation,
  formatComment,
  selectedLines,
  type CommentLocation,
  type LineChange,
} from "./diff-comment";

const entry = { path: "src/a.ts", oldPath: null, status: "modified" } as const;

/** Old lines 3-4 become new lines 3-5 (one line added); old line 8 is deleted outright. */
const CHANGES: readonly LineChange[] = [
  {
    originalStartLineNumber: 3,
    originalEndLineNumber: 4,
    modifiedStartLineNumber: 3,
    modifiedEndLineNumber: 5,
  },
  {
    originalStartLineNumber: 8,
    originalEndLineNumber: 8,
    modifiedStartLineNumber: 8,
    modifiedEndLineNumber: 0,
  },
];

describe("commentLocation", () => {
  it("names a single new-side line", () => {
    expect(commentLocation({ entry, side: "modified", from: 4, to: 4, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 4,
      to: 4,
      suffix: null,
    });
  });

  it("names a new-side range", () => {
    expect(commentLocation({ entry, side: "modified", from: 2, to: 6, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 2,
      to: 6,
      suffix: null,
    });
  });

  it("maps unchanged old-side lines to new numbers", () => {
    // Old 5-7 follow a change that grew by one line, so they sit at new 6-8… up to the deletion.
    expect(commentLocation({ entry, side: "original", from: 5, to: 7, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 6,
      to: 8,
      suffix: null,
    });
    // Old 9 follows the grown change and the deleted line: net +1 -1.
    expect(commentLocation({ entry, side: "original", from: 9, to: 9, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 9,
      to: 9,
      suffix: null,
    });
  });

  it("names deleted-only old lines by old numbers", () => {
    expect(commentLocation({ entry, side: "original", from: 8, to: 8, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 8,
      to: 8,
      suffix: "(deleted lines)",
    });
    expect(commentLocation({ entry, side: "original", from: 3, to: 4, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 3,
      to: 4,
      suffix: "(deleted lines)",
    });
  });

  it("names the old path for deleted-only lines of a renamed file", () => {
    const renamed = { path: "src/b.ts", oldPath: "src/a.ts", status: "renamed" } as const;
    expect(
      commentLocation({ entry: renamed, side: "original", from: 8, to: 8, changes: CHANGES }),
    ).toEqual({ path: "src/a.ts", from: 8, to: 8, suffix: "(deleted lines)" });
    expect(
      commentLocation({ entry: renamed, side: "original", from: 6, to: 6, changes: CHANGES }),
    ).toMatchObject({ path: "src/b.ts" });
  });

  it("falls back to the current path when a rename came from outside the folder", () => {
    const renamed = { path: "src/b.ts", oldPath: null, status: "renamed" } as const;
    expect(
      commentLocation({ entry: renamed, side: "original", from: 8, to: 8, changes: CHANGES }),
    ).toMatchObject({ path: "src/b.ts", suffix: "(deleted lines)" });
  });

  it("names the new range a mixed old-side selection touches", () => {
    // Old 2-5: unchanged 2 (new 2), replaced 3-4 (new 3-5), unchanged 5 (new 6).
    expect(commentLocation({ entry, side: "original", from: 2, to: 5, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 2,
      to: 6,
      suffix: "(across deletions and additions)",
    });
    // Old 7-9 around a pure deletion: only the unchanged lines have new numbers.
    expect(commentLocation({ entry, side: "original", from: 7, to: 9, changes: CHANGES })).toEqual({
      path: "src/a.ts",
      from: 8,
      to: 9,
      suffix: "(across deletions and additions)",
    });
  });

  it("treats every old line of a deleted file as deleted", () => {
    const deleted = { path: "src/gone.ts", oldPath: null, status: "deleted" } as const;
    expect(
      commentLocation({ entry: deleted, side: "original", from: 1, to: 3, changes: [] }),
    ).toEqual({ path: "src/gone.ts", from: 1, to: 3, suffix: "(deleted lines)" });
  });

  it("names the new side of added and untracked files plainly", () => {
    for (const status of ["added", "untracked"] as const) {
      expect(
        commentLocation({
          entry: { path: "new.ts", oldPath: null, status },
          side: "modified",
          from: 1,
          to: 2,
          changes: [],
        }),
      ).toEqual({ path: "new.ts", from: 1, to: 2, suffix: null });
    }
  });
});

describe("selectedLines", () => {
  it("drops a last line the selection only touches at column 1", () => {
    expect(
      selectedLines({ startLineNumber: 2, startColumn: 1, endLineNumber: 5, endColumn: 1 }),
    ).toEqual({ from: 2, to: 4 });
  });

  it("keeps the end line when the selection reaches into it", () => {
    expect(
      selectedLines({ startLineNumber: 2, startColumn: 3, endLineNumber: 5, endColumn: 4 }),
    ).toEqual({ from: 2, to: 5 });
  });

  it("reads a backwards selection and a bare cursor", () => {
    expect(
      selectedLines({ startLineNumber: 5, startColumn: 4, endLineNumber: 2, endColumn: 3 }),
    ).toEqual({ from: 2, to: 5 });
    expect(
      selectedLines({ startLineNumber: 7, startColumn: 2, endLineNumber: 7, endColumn: 2 }),
    ).toEqual({ from: 7, to: 7 });
  });
});

describe("formatComment", () => {
  const single: CommentLocation = { path: "src/a.ts", from: 4, to: 4, suffix: null };
  const range: CommentLocation = { path: "src/a.ts", from: 4, to: 9, suffix: null };

  it("prints a single line and a range", () => {
    expect(formatComment(single, "rename this")).toBe("In src/a.ts:L4: rename this");
    expect(formatComment(range, "wrong branch")).toBe("In src/a.ts:L4-L9: wrong branch");
  });

  it("puts the suffix between the range and the comment", () => {
    expect(formatComment({ ...range, suffix: "(deleted lines)" }, "why removed?")).toBe(
      "In src/a.ts:L4-L9 (deleted lines): why removed?",
    );
  });

  it("collapses line breaks to single spaces", () => {
    expect(formatComment(single, "first\nsecond\r\n\n  third")).toBe(
      "In src/a.ts:L4: first second third",
    );
  });

  it("strips escape sequences and terminal controls from the whole payload", () => {
    expect(formatComment(single, "\x1b[31mred\x1b[0m\x07 ok\x1b]0;title\x07")).toBe(
      "In src/a.ts:L4: red ok",
    );
    expect(formatComment({ ...single, path: "a\x1b[2Jb\n.ts" }, "x")).toBe("In ab .ts:L4: x");
  });

  it("rejects a comment that is empty once cleaned", () => {
    expect(formatComment(single, "")).toBeNull();
    expect(formatComment(single, " \n\t \x1b[0m\x07")).toBeNull();
  });
});
