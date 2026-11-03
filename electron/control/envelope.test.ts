import { describe, expect, it } from "vitest";
import { parseWorkerEnvelope, WORKER_BLOCKED_HEADER, WORKER_DONE_HEADER } from "./envelope";

const doneLines = (task = "T1") => [
  WORKER_DONE_HEADER,
  `task: ${task}`,
  "summary: Added the parser",
  "files: electron/control/envelope.ts, electron/control/envelope.test.ts",
  "checks: npx vitest run (9 passed)",
  "handoff: wire it into the read route",
];

const blockedLines = (task = "T2") => [
  WORKER_BLOCKED_HEADER,
  `task: ${task}`,
  "reason: the schema file is missing",
  "needs: a decision on where it lives",
];

const doneEnvelope = (task = "T1") => ({
  kind: "done",
  task,
  summary: "Added the parser",
  files: "electron/control/envelope.ts, electron/control/envelope.test.ts",
  checks: "npx vitest run (9 passed)",
  handoff: "wire it into the read route",
});

describe("parseWorkerEnvelope", () => {
  it("reads a done block", () => {
    expect(parseWorkerEnvelope(doneLines().join("\n"))).toEqual(doneEnvelope());
  });

  it("reads a blocked block", () => {
    expect(parseWorkerEnvelope(blockedLines().join("\n"))).toEqual({
      kind: "blocked",
      task: "T2",
      reason: "the schema file is missing",
      needs: "a decision on where it lives",
    });
  });

  it("returns null for a truncated block", () => {
    expect(parseWorkerEnvelope(doneLines().slice(0, -1).join("\n"))).toBeNull();
  });

  it("returns null for empty input and for text with no header", () => {
    expect(parseWorkerEnvelope("")).toBeNull();
    expect(parseWorkerEnvelope("task: T1\nsummary: no header above\n")).toBeNull();
  });

  it("lets the last block win, whatever its kind", () => {
    const text = [...doneLines("T1"), "", "more output", ...blockedLines("T2")].join("\n");
    expect(parseWorkerEnvelope(text)).toMatchObject({ kind: "blocked", task: "T2" });
    const reversed = [...blockedLines("T2"), ...doneLines("T3")].join("\n");
    expect(parseWorkerEnvelope(reversed)).toMatchObject({ kind: "done", task: "T3" });
  });

  it("does not fall back to an earlier block when the last one is incomplete", () => {
    const text = [...doneLines("T1"), "", ...doneLines("T2").slice(0, 3)].join("\n");
    expect(parseWorkerEnvelope(text)).toBeNull();
  });

  it.each([
    ["a longer word before it", `X${WORKER_DONE_HEADER}`],
    ["a suffix after it", `${WORKER_DONE_HEADER}_2`],
    ["text before it on the line", `prefix ${WORKER_DONE_HEADER}`],
    ["text after it on the line", `${WORKER_DONE_HEADER} done!`],
    ["an underscore before it", `_${WORKER_DONE_HEADER}`],
    ["a digit before it", `2${WORKER_DONE_HEADER}`],
  ])("ignores a header with %s", (_label, header) => {
    const fields = doneLines().slice(1);
    expect(parseWorkerEnvelope([header, ...fields].join("\n"))).toBeNull();
    // An ignored look-alike after a real block must not hide the real one.
    const text = [...doneLines(), "", header, ...fields.slice(0, 1)].join("\n");
    expect(parseWorkerEnvelope(text)).toEqual(doneEnvelope());
  });

  it("accepts trailing whitespace after the header", () => {
    const lines = doneLines();
    lines[0] = `${WORKER_DONE_HEADER} \t`;
    expect(parseWorkerEnvelope(lines.join("\n"))).toEqual(doneEnvelope());
  });

  it("normalises CRLF and lone CR line endings", () => {
    expect(parseWorkerEnvelope(doneLines().join("\r\n") + "\r\n")).toEqual(doneEnvelope());
    expect(parseWorkerEnvelope(doneLines().join("\r"))).toEqual(doneEnvelope());
  });

  it.each([
    ["a bullet on the header and indented keys", "⏺ ", "  "],
    ["a box gutter", "│ ", "│ "],
    ["a quote gutter", "> ", "> "],
    ["indentation only", "  ", "  "],
  ])("reads a block drawn with %s", (_label, first, rest) => {
    const draw = (lines: string[]) =>
      lines.map((line, i) => (i === 0 ? first : rest) + line).join("\n");
    expect(parseWorkerEnvelope(draw(doneLines()))).toEqual(doneEnvelope());
    expect(parseWorkerEnvelope(draw(blockedLines()))).toMatchObject({
      kind: "blocked",
      task: "T2",
      needs: "a decision on where it lives",
    });
  });

  describe("a template echoed on screen", () => {
    const templateLines = (prefix = "") =>
      [
        WORKER_DONE_HEADER,
        "task: <task id>",
        "summary: <one line>",
        "files: <comma-separated paths or none>",
        "checks: <commands and outcomes>",
        "handoff: <next-step context or none>",
        WORKER_BLOCKED_HEADER,
        "task: <task id>",
        "reason: <one line>",
        "needs: <decision, access or dependency>",
      ].map((line) => prefix + line);

    it("is no envelope on its own, plain or quoted", () => {
      expect(parseWorkerEnvelope(templateLines().join("\n"))).toBeNull();
      expect(parseWorkerEnvelope(templateLines("> ").join("\n"))).toBeNull();
    });

    it("does not hide the real block before it", () => {
      for (const prefix of ["", "> ", "│ "]) {
        const text = [...doneLines(), "", ...templateLines(prefix)].join("\n");
        expect(parseWorkerEnvelope(text)).toEqual(doneEnvelope());
      }
    });

    it("is skipped even when only part of it is on screen", () => {
      const text = [...doneLines(), "", ...templateLines().slice(0, 3)].join("\n");
      expect(parseWorkerEnvelope(text)).toEqual(doneEnvelope());
    });

    it("does not rescue a malformed real block between the two", () => {
      const text = [...doneLines("T1"), "", ...doneLines("T2").slice(0, 3), ...templateLines()];
      expect(parseWorkerEnvelope(text.join("\n"))).toBeNull();
    });

    it("needs both angle brackets to count as a placeholder", () => {
      const open = doneLines("<T1");
      const close = doneLines("T1>");
      expect(parseWorkerEnvelope(open.join("\n"))).toMatchObject({ task: "<T1" });
      expect(parseWorkerEnvelope(close.join("\n"))).toMatchObject({ task: "T1>" });
    });
  });

  it("is not thrown off by terminal noise around the block", () => {
    const text = [
      "╭──────────────────────────────╮",
      "│ > Task T1: add the parser    │",
      "╰──────────────────────────────╯",
      "● Working on it...",
      "",
      ...doneLines(),
      "",
      "╭──────────────────────────────╮",
      "│ >                            │",
      "╰──────────────────────────────╯",
      "  ? for shortcuts",
    ].join("\n");
    expect(parseWorkerEnvelope(text)).toEqual(doneEnvelope());
  });

  it("ends the block at the first line that is not one of its keys", () => {
    const lines = doneLines();
    lines.splice(3, 0, "● still thinking");
    expect(parseWorkerEnvelope(lines.join("\n"))).toBeNull();
  });

  it("accepts the keys in any order", () => {
    const [header, ...fields] = doneLines();
    expect(parseWorkerEnvelope([header, ...fields.reverse()].join("\n"))).toEqual(doneEnvelope());
  });

  it("keeps a value that contains colons whole, and trims its edges", () => {
    const lines = doneLines();
    lines[2] = "summary:   Fix: parser: handle a: b   ";
    lines[4] = "checks: vitest: 9 passed; tsc: ok";
    expect(parseWorkerEnvelope(lines.join("\n"))).toMatchObject({
      summary: "Fix: parser: handle a: b",
      checks: "vitest: 9 passed; tsc: ok",
    });
  });

  it('passes "none" through as the string', () => {
    const lines = doneLines();
    lines[3] = "files: none";
    lines[5] = "handoff: none";
    expect(parseWorkerEnvelope(lines.join("\n"))).toMatchObject({
      files: "none",
      handoff: "none",
    });
  });

  it("keeps the first value of a key that repeats after the block is complete", () => {
    const text = [...doneLines("T1"), "task: T9"].join("\n");
    expect(parseWorkerEnvelope(text)).toMatchObject({ task: "T1" });
  });

  it("ends the block at a repeated key, which leaves later keys missing", () => {
    const lines = doneLines();
    lines.splice(3, 0, "task: T9");
    expect(parseWorkerEnvelope(lines.join("\n"))).toBeNull();
  });
});
