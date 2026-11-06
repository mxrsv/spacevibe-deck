import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESSORY_KEYS, createInputBatcher, sequenceFor, splitInput } from "./keys";

describe("accessory keys", () => {
  it("send the sequences a terminal expects", () => {
    expect(sequenceFor("esc")).toBe("\x1b");
    expect(sequenceFor("tab")).toBe("\t");
    expect(sequenceFor("shift-tab")).toBe("\x1b[Z");
    expect(sequenceFor("ctrl-c")).toBe("\x03");
    expect(sequenceFor("up")).toBe("\x1b[A");
    expect(sequenceFor("down")).toBe("\x1b[B");
    expect(sequenceFor("right")).toBe("\x1b[C");
    expect(sequenceFor("left")).toBe("\x1b[D");
    expect(sequenceFor("enter")).toBe("\r");
    expect(ACCESSORY_KEYS.map((k) => k.id)).toHaveLength(9);
  });
});

describe("splitInput", () => {
  it("cuts to the limit without splitting a surrogate pair", () => {
    expect(splitInput("abcdef", 4)).toEqual(["abcd", "ef"]);
    expect(splitInput("abc😀def", 4)).toEqual(["abc", "😀de", "f"]);
    expect(splitInput("")).toEqual([]);
  });
});

describe("input batcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins keystrokes within a frame into one send, in order", () => {
    const sent: string[] = [];
    const batcher = createInputBatcher({ send: (d) => sent.push(d) });
    batcher.push("l");
    batcher.push("s");
    vi.advanceTimersByTime(10);
    batcher.push("\r");
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(7);
    expect(sent).toEqual(["ls\r"]);
    batcher.push("x");
    vi.advanceTimersByTime(16);
    expect(sent).toEqual(["ls\r", "x"]);
  });

  it("splits a paste larger than the limit and flushes on demand", () => {
    const sent: string[] = [];
    const batcher = createInputBatcher({ send: (d) => sent.push(d), max: 5 });
    batcher.push("0123456789ab");
    batcher.flush();
    expect(sent).toEqual(["01234", "56789", "ab"]);
  });

  it("drops what is pending when disposed", () => {
    const sent: string[] = [];
    const batcher = createInputBatcher({ send: (d) => sent.push(d) });
    batcher.push("a");
    batcher.dispose();
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([]);
  });
});
