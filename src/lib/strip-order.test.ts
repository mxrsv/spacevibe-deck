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

  it("shares manual order and the pinned prefix across owner index spaces", () => {
    expect(
      mergeStripOrder([at(1), at(3)], [at(2), at(4)], {
        order: [4, 3, 2, 1],
        pinned: [2],
      }),
    ).toEqual([
      { kind: "surface", index: 0 },
      { kind: "surface", index: 1 },
      { kind: "tab", index: 1 },
      { kind: "tab", index: 0 },
    ]);
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

describe("manual strip preferences", () => {
  it("moves visible chips while preserving hidden positions and pin groups", async () => {
    const { stripPreferences, moveStripTab, EMPTY_STRIP_PREFERENCES } =
      await import("./strip-order");
    stripPreferences.value = { order: [1, 2, 3, 4, 5], pinned: [1] };
    moveStripTab(5, 3, [1, 3, 5], [1, 2, 3, 4, 5]);
    expect(stripPreferences.value).toEqual({ order: [1, 2, 5, 4, 3], pinned: [1] });
    moveStripTab(3, 1, [1, 5, 3], [1, 2, 3, 4, 5]);
    expect(stripPreferences.value.order).toEqual([1, 2, 5, 4, 3]);
    stripPreferences.value = EMPTY_STRIP_PREFERENCES;
  });

  it("unpin restores the manual slot and new chips append", async () => {
    const { stripPreferences, setStripPinned, EMPTY_STRIP_PREFERENCES } =
      await import("./strip-order");
    stripPreferences.value = { order: [3, 1, 2], pinned: [] };
    setStripPinned(2, true);
    expect(
      mergeStripOrder([at(1), at(2), at(3), at(4)], [], stripPreferences.value).map((s) => s.index),
    ).toEqual([1, 2, 0, 3]);
    setStripPinned(2, false);
    expect(
      mergeStripOrder([at(1), at(2), at(3), at(4)], [], stripPreferences.value).map((s) => s.index),
    ).toEqual([2, 0, 1, 3]);
    stripPreferences.value = EMPTY_STRIP_PREFERENCES;
  });
});
