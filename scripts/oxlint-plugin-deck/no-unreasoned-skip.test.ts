import { describe, expect, it } from "vitest";
import { lintFixtures } from "./lint-fixtures";

const findings = lintFixtures("no-unreasoned-skip", {
  "tracked.test.ts": "// skip: #123 the fixture server needs IPv6\nit.skip('a', () => {});\n",
  "tracked-url.test.ts":
    "describe('d', () => {\n  // https://github.com/mxrsv/spacevibe-deck/issues/9\n  it.todo('b');\n});\n",
  "platform-gate.test.ts": "it.skipIf(process.platform === 'win32')('c', () => {});\n",
  "runtime-skip.test.ts": "it('d', (context) => { context.skip('no openssl'); });\n",
  "computed-option.test.ts": "it('e', { skip: isWindows }, () => {});\n",
  "not-a-test.ts": "it.skip('f', () => {});\n",
  "skip.test.ts": "it.skip('g', () => {});\n",
  "only.test.ts": "\ndescribe.only('h', () => {});\n",
  "each.test.ts": "it.skip.each([1, 2])('i %i', () => {});\n",
  "prefixed.test.ts": "xit('j', () => {});\n",
  "option.test.ts": "test('k', { skip: true }, () => {});\n",
  "untracked-comment.test.ts": "// flaky, look later\nit.skip('l', () => {});\n",
});

describe("deck/no-unreasoned-skip", () => {
  it.each([
    "tracked.test.ts",
    "tracked-url.test.ts",
    "platform-gate.test.ts",
    "runtime-skip.test.ts",
    "computed-option.test.ts",
    "not-a-test.ts",
  ])("accepts %s", (name) => {
    expect(findings[name]).toEqual([]);
  });

  it.each([
    ["skip.test.ts", 1],
    ["only.test.ts", 2],
    ["each.test.ts", 1],
    ["prefixed.test.ts", 1],
    ["option.test.ts", 1],
    ["untracked-comment.test.ts", 2],
  ])("reports %s on line %i", (name, line) => {
    expect(findings[name]).toEqual([{ line, message: expect.stringMatching(/^Name the issue/) }]);
  });
});
