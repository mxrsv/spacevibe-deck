import { describe, expect, it } from "vitest";
import { lintFixtures } from "./lint-fixtures";

const findings = lintFixtures("require-suppression-reason", {
  "inline-reason.ts":
    "// eslint-disable-next-line no-control-regex -- ESC is the point\nconst a = /\\x1b/;\n",
  "block-reason.ts": "/* oxlint-disable max-lines -- one fixture table */\nexport {};\n",
  "comment-above.ts": [
    "// Mount only: the ref carries the current callback.",
    "// eslint-disable-next-line react-hooks/exhaustive-deps",
    "export {};",
  ].join("\n"),
  "stacked.ts": [
    "// Both rules trip on the generated table below.",
    "// oxlint-disable-next-line no-unused-vars",
    "// eslint-disable-next-line no-explicit-any",
    "export {};",
  ].join("\n"),
  "ts-reason.ts": "// @ts-expect-error — plain ESM script, no types\nexport {};\n",
  "enable.ts":
    "/* oxlint-disable no-await-in-loop -- in order */\n/* oxlint-enable no-await-in-loop */\n",
  "bare.ts": "const x = 1;\n// eslint-disable-next-line no-control-regex\nconst a = /\\x1b/;\n",
  "trailing.ts": "const a = /\\x1b/; // eslint-disable-line no-control-regex\n",
  "file-level.ts": "/* oxlint-disable max-lines */\nexport {};\n",
  "ts-bare.ts": "const y = 2;\n// @ts-expect-error\nexport {};\n",
  "blank-above.ts": "//\n// eslint-disable-next-line no-control-regex\nconst a = /\\x1b/;\n",
});

describe("deck/require-suppression-reason", () => {
  it.each([
    "inline-reason.ts",
    "block-reason.ts",
    "comment-above.ts",
    "stacked.ts",
    "ts-reason.ts",
    "enable.ts",
  ])("accepts %s", (name) => {
    expect(findings[name]).toEqual([]);
  });

  it.each([
    ["bare.ts", 2],
    ["trailing.ts", 1],
    ["file-level.ts", 1],
    ["ts-bare.ts", 2],
    ["blank-above.ts", 2],
  ])("reports %s on line %i", (name, line) => {
    expect(findings[name]).toEqual([{ line, message: expect.stringMatching(/^Say why/) }]);
  });
});
