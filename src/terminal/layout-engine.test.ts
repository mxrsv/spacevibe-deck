// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { leaf, type TreeNode } from "../lib/split-tree";
import { computeDisplayTree, createLayoutEngine, EXPAND_RATIO } from "./layout-engine";

describe("computeDisplayTree", () => {
  const tree: TreeNode = {
    kind: "split",
    dir: "row",
    ratio: 0.5,
    a: leaf(1),
    b: leaf(2),
  };

  it("returns the structural tree when Focus Expand is off", () => {
    expect(computeDisplayTree(tree, 1, false, 2)).toBe(tree);
  });

  it("returns the structural tree for a single pane", () => {
    const one = leaf(1);
    expect(computeDisplayTree(one, 1, true, 1)).toBe(one);
  });

  it("returns the structural tree when there is no Focused pane", () => {
    expect(computeDisplayTree(tree, null, true, 2)).toBe(tree);
  });

  it("expands the Focused pane along its path", () => {
    const display = computeDisplayTree(tree, 1, true, 2, EXPAND_RATIO);
    expect(display).not.toBe(tree);
    if (display.kind !== "split") {
      throw new Error("expected split");
    }
    expect(display.ratio).toBe(EXPAND_RATIO);
  });
});

describe("split divider drag", () => {
  function mountSplit(onRatioCommit: (path: unknown, ratio: number) => void) {
    const container = document.createElement("div");
    const engine = createLayoutEngine(container, {
      getPaneElement: () => document.createElement("div"),
      mountPane: () => {},
      fitPane: () => {},
      focusPane: () => {},
    });
    engine.sync({
      tree: { kind: "split", dir: "row", ratio: 0.5, a: leaf(1), b: leaf(2) },
      activeId: 1,
      paneCount: 2,
      focusExpand: false,
      onRatioCommit,
    });
    const split = container.querySelector<HTMLElement>(".split")!;
    // jsdom lays nothing out: a zero-width split would turn every move into NaN.
    split.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
    const divider = container.querySelector<HTMLElement>(".split__divider")!;
    // jsdom implements neither pointer capture method.
    divider.setPointerCapture = vi.fn();
    divider.releasePointerCapture = vi.fn();
    const first = split.querySelector<HTMLElement>(":scope > .split__child")!;
    const pointer = (type: string, clientX: number, buttons: number): void => {
      divider.dispatchEvent(
        new PointerEvent(type, { clientX, pointerId: 1, buttons, bubbles: true }),
      );
    };
    return { divider, first, pointer };
  }

  // Owner report 2026-11-04: a release that never arrived left the divider
  // following a pointer with no button held.
  it("ends a drag whose release never arrived at the first move with no button held", () => {
    const onRatioCommit = vi.fn();
    const { divider, first, pointer } = mountSplit(onRatioCommit);

    pointer("pointerdown", 500, 1);
    pointer("pointermove", 300, 1);
    expect(first.style.flexGrow).toBe("0.3");

    pointer("pointermove", 700, 0);
    expect(onRatioCommit).toHaveBeenCalledTimes(1);
    expect(onRatioCommit).toHaveBeenCalledWith([], 0.3);
    expect(divider.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(divider.classList.contains("is-dragging")).toBe(false);

    pointer("pointermove", 800, 1);
    expect(first.style.flexGrow).toBe("0.3");
  });

  it("ends the drag on pointercancel, which it used to ignore", () => {
    const onRatioCommit = vi.fn();
    const { divider, pointer } = mountSplit(onRatioCommit);

    pointer("pointerdown", 500, 1);
    pointer("pointermove", 600, 1);
    pointer("pointercancel", 600, 0);

    expect(onRatioCommit).toHaveBeenCalledWith([], 0.6);
    expect(divider.classList.contains("is-dragging")).toBe(false);
  });
});
