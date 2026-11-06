import { describe, expect, it } from "vitest";
import { classifyDiff, widestLine } from "./diff-lines";

const kinds = (diff: string): string[] => classifyDiff(diff).map((l) => l.kind);

describe("classifyDiff", () => {
  it("colours a git diff: header meta, hunk, add, remove, context", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,3 @@ fn",
      " keep",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    expect(kinds(diff)).toEqual([
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "remove",
      "add",
      "meta",
    ]);
  });

  it("judges lines after the first hunk by their first character only", () => {
    const diff = "@@ -1 +1 @@\n--- not a header\n+++ also content\n";
    expect(kinds(diff)).toEqual(["hunk", "remove", "add"]);
  });

  it("reads the desktop's synthetic diff of an untracked file", () => {
    const diff = "+++ notes.md\n+# Title\n+++ looks like a header but is content\n";
    expect(kinds(diff)).toEqual(["meta", "add", "add"]);
  });

  it("handles an empty diff and measures the widest line", () => {
    expect(classifyDiff("")).toEqual([]);
    expect(widestLine(classifyDiff("@@ @@\n+abcdef\n x"))).toBe(7);
    expect(widestLine(classifyDiff(`+${"x".repeat(2000)}`))).toBe(400);
  });
});
