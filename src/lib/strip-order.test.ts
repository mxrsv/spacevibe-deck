import { describe, expect, it } from "vitest";
import { mergeStripOrder } from "./strip-order";
import { nextOpenSequence, resetOpenSequence, UNSEQUENCED } from "./open-sequence";

const at = (openedAt: number) => ({ openedAt });

describe("mergeStripOrder", () => {
  it("interleaves the two index spaces by when each chip was opened", () => {
    // tab, file, tab, browser — the row a user builds by opening a terminal,
    // clicking a file, opening another terminal, then the browser.
    const slots = mergeStripOrder([at(1), at(3)], [at(2), at(4)]);

    expect(slots).toEqual([
      { kind: "tab", index: 0 },
      { kind: "surface", index: 0 },
      { kind: "tab", index: 1 },
      { kind: "surface", index: 1 },
    ]);
  });

  it("keeps each owner's own index, never the merged position", () => {
    // The surface opened FIRST is still `SurfaceStrip` index 0 — the index
    // `activate()` takes. A merge that renumbered would activate the wrong
    // surface every time a terminal tab sorted before it.
    const slots = mergeStripOrder([at(9)], [at(2), at(5)]);

    expect(slots).toEqual([
      { kind: "surface", index: 0 },
      { kind: "surface", index: 1 },
      { kind: "tab", index: 0 },
    ]);
  });

  it("falls back to tabs-then-surfaces when nothing carries a key", () => {
    // `UNSEQUENCED` is what a fixture or a pre-2026-08-16 `TabView` reports,
    // and a whole strip of them must still render in the old order rather
    // than an arbitrary one.
    const slots = mergeStripOrder([at(UNSEQUENCED), at(UNSEQUENCED)], [at(UNSEQUENCED)]);

    expect(slots).toEqual([
      { kind: "tab", index: 0 },
      { kind: "tab", index: 1 },
      { kind: "surface", index: 0 },
    ]);
  });

  it("handles either side being empty", () => {
    expect(mergeStripOrder([], [])).toEqual([]);
    expect(mergeStripOrder([at(1)], [])).toEqual([{ kind: "tab", index: 0 }]);
    expect(mergeStripOrder([], [at(1)])).toEqual([{ kind: "surface", index: 0 }]);
  });
});

describe("the open-order clock", () => {
  it("hands out strictly increasing keys", () => {
    resetOpenSequence();
    const keys = [nextOpenSequence(), nextOpenSequence(), nextOpenSequence()];

    expect(keys).toEqual([1, 2, 3]);
    // Never `UNSEQUENCED`: a real chip must always outrank a fixture one.
    expect(keys.every((key) => key > UNSEQUENCED)).toBe(true);
  });
});
