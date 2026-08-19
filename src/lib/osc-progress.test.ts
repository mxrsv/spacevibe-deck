import { describe, expect, it } from "vitest";
import { lastProgressState, OSC_CARRY_LENGTH, parseProgressEvents } from "./osc-progress";

describe("lastProgressState", () => {
  it("parses a BEL-terminated busy report", () => {
    expect(lastProgressState("\x1b]9;4;3\x07")).toBe(3);
  });

  it("parses an ST-terminated report with a progress value", () => {
    expect(lastProgressState("\x1b]9;4;1;42\x1b\\")).toBe(1);
  });

  it("treats a bare 9;4 with no params as clear", () => {
    expect(lastProgressState("\x1b]9;4\x07")).toBe(0);
  });

  it("returns the last state when a chunk holds several reports", () => {
    expect(lastProgressState("\x1b]9;4;3\x07 output \x1b]9;4;0\x07")).toBe(0);
  });

  it("returns null for text without any report", () => {
    expect(lastProgressState("plain output")).toBeNull();
    expect(lastProgressState("")).toBeNull();
  });

  it("ignores other OSC sequences (title, notifications)", () => {
    expect(lastProgressState("\x1b]0;my title\x07")).toBeNull();
    expect(lastProgressState("\x1b]9;a notification\x07")).toBeNull();
  });

  it("finds a report embedded in surrounding output", () => {
    expect(lastProgressState("hello\x1b]9;4;2;10\x1b\\world")).toBe(2);
  });
});

describe("parseProgressEvents", () => {
  it("preserves every event in order for working → error → clear in one chunk", () => {
    const chunk = "\x1b]9;4;1\x07working\x1b]9;4;2\x07broken\x1b]9;4\x07idle";
    const { events, carry } = parseProgressEvents("", chunk);
    expect(events).toEqual([{ state: 1 }, { state: 2 }, { state: 0 }]);
    expect(carry).toBe("");
  });

  it("preserves every event in order for warning → clear in one chunk", () => {
    const chunk = "\x1b]9;4;4;5\x07careful\x1b]9;4\x07idle";
    const { events, carry } = parseProgressEvents("", chunk);
    expect(events).toEqual([{ state: 4, progress: 5 }, { state: 0 }]);
    expect(carry).toBe("");
  });

  it("keeps raw state values for error (2), warning (4) and unknown non-zero (7)", () => {
    const { events } = parseProgressEvents("", "\x1b]9;4;2\x07\x1b]9;4;4\x07\x1b]9;4;7\x07");
    expect(events).toEqual([{ state: 2 }, { state: 4 }, { state: 7 }]);
    expect(lastProgressState("\x1b]9;4;7\x07")).toBe(7);
  });

  it("returns carry '' when the buffer ends exactly at a terminator", () => {
    const { carry } = parseProgressEvents("", "\x1b]9;4;1\x07");
    expect(carry).toBe("");
  });

  it("does not re-emit a sequence completed at the end of the previous chunk", () => {
    const first = parseProgressEvents("", "\x1b]9;4;1\x07");
    expect(first.events).toEqual([{ state: 1 }]);
    expect(first.carry).toBe("");

    const second = parseProgressEvents(first.carry, "plain output");
    expect(second.events).toEqual([]);
  });

  it("splits after a lone ESC and carries an incomplete prefix", () => {
    const chunk1 = parseProgressEvents("", "before\x1b");
    expect(chunk1.events).toEqual([]);
    expect(chunk1.carry).toBe("\x1b");

    const chunk2 = parseProgressEvents(chunk1.carry, "]9;4;3\x07after");
    expect(chunk2.events).toEqual([{ state: 3 }]);
    expect(chunk2.carry).toBe("");
  });

  it("splits after '\\x1b]9;4;' and carries the incomplete prefix", () => {
    const chunk1 = parseProgressEvents("", "\x1b]9;4;");
    expect(chunk1.carry).toBe("\x1b]9;4;");

    const chunk2 = parseProgressEvents(chunk1.carry, "3\x07");
    expect(chunk2.events).toEqual([{ state: 3 }]);
    expect(chunk2.carry).toBe("");
  });

  it("splits between state and progress and carries the incomplete prefix", () => {
    const chunk1 = parseProgressEvents("", "\x1b]9;4;1");
    expect(chunk1.carry).toBe("\x1b]9;4;1");

    const chunk2 = parseProgressEvents(chunk1.carry, ";42\x1b\\");
    expect(chunk2.events).toEqual([{ state: 1, progress: 42 }]);
    expect(chunk2.carry).toBe("");
  });

  it("splits between the ESC and backslash of the ST terminator and carries the incomplete prefix", () => {
    const chunk1 = parseProgressEvents("", "\x1b]9;4;1;42\x1b");
    expect(chunk1.carry).toBe("\x1b]9;4;1;42\x1b");

    const chunk2 = parseProgressEvents(chunk1.carry, "\\");
    expect(chunk2.events).toEqual([{ state: 1, progress: 42 }]);
    expect(chunk2.carry).toBe("");
  });

  it("does not carry an unrelated incomplete OSC sequence (e.g. a title) as progress", () => {
    const { events, carry } = parseProgressEvents("", "\x1b]0;partial title");
    expect(events).toEqual([]);
    expect(carry).toBe("");
  });

  it("drops a candidate carry that exceeds the hard cap instead of growing unbounded", () => {
    const hugeDigits = "1".repeat(OSC_CARRY_LENGTH + 10);
    const { events, carry } = parseProgressEvents("", `\x1b]9;4;${hugeDigits}`);
    expect(events).toEqual([]);
    expect(carry).toBe("");
  });
});
