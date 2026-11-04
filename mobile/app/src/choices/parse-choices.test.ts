import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { choiceInput, parseChoices } from "./parse-choices";

const fixture = (name: string): string =>
  readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

describe("parseChoices on realistic agent screens", () => {
  it("reads Claude Code's boxed permission prompt, with a wrapped option", () => {
    const choices = parseChoices(fixture("claude-permission.txt"));
    expect(choices?.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(choices?.[0]).toMatchObject({ label: "Yes", selected: true });
    expect(choices?.[1].label).toMatch(/^Yes, and don’t ask again for npm test/);
    expect(choices?.[1].selected).toBe(false);
    expect(choices?.[2].label).toMatch(/^No, and tell Claude/);
  });

  it("reads the same prompt without the box", () => {
    expect(parseChoices(fixture("claude-permission-plain.txt"))?.map((c) => c.label[0])).toEqual([
      "Y",
      "Y",
      "N",
    ]);
  });

  it("reads Codex's approval list under its › marker", () => {
    const choices = parseChoices(fixture("codex-approval.txt"));
    expect(choices?.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(choices?.[0]).toMatchObject({ selected: true });
    expect(choices?.[0].label).toMatch(/^Yes, proceed/);
    expect(choices?.[2].label).toMatch(/^No, and tell Codex/);
  });

  it("reads opencode's numbered question, ignoring its description lines and hints", () => {
    const choices = parseChoices(fixture("opencode-question.txt"));
    expect(choices?.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(choices?.[0].label).toBe("vitest Matches the rest of the repo");
  });

  it("finds nothing in opencode's permission dialog, which has no numbers", () => {
    expect(parseChoices(fixture("opencode-permission.txt"))).toBeNull();
  });
});

describe("parseChoices negatives", () => {
  it("ignores a numbered list higher up the screen when output follows it", () => {
    expect(parseChoices(fixture("negative-list-high-up.txt"))).toBeNull();
  });

  it("ignores a markdown list the agent printed above an idle input box", () => {
    expect(parseChoices(fixture("negative-markdown-list-idle.txt"))).toBeNull();
  });

  it("ignores a markdown list the agent printed and then kept working on", () => {
    expect(parseChoices(fixture("negative-markdown-list-working.txt"))).toBeNull();
  });

  it("needs at least two options, counting up from 1", () => {
    expect(parseChoices(fixture("negative-single-option.txt"))).toBeNull();
    expect(parseChoices("  2. Yes\n  3. No\n")).toBeNull();
    expect(parseChoices("  1. Yes\n  3. No\n")).toBeNull();
    expect(parseChoices("")).toBeNull();
  });

  it("accepts an unmarked list only when it is the last thing on the screen", () => {
    expect(parseChoices("Pick one\n1. alpha\n2. beta\n")?.length).toBe(2);
    expect(parseChoices("1. alpha\n2. beta\nline a\nline b\nline c\nline d\n")).toBeNull();
  });
});

describe("choiceInput", () => {
  it("is the digit, with no Enter", () => {
    expect(choiceInput({ number: 2, label: "x", selected: false })).toBe("2");
  });
});
