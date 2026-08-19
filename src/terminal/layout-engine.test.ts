import { describe, expect, it } from "vitest";
import { leaf, type TreeNode } from "../lib/split-tree";
import { computeDisplayTree, EXPAND_RATIO } from "./layout-engine";

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
