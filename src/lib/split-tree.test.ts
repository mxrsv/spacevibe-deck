import { describe, expect, it } from "vitest";
import {
  countLeaves,
  dockNewPane,
  expandForPane,
  leaf,
  leafIds,
  movePane,
  ratioEntries,
  serializeTree,
  setRatio,
  splitLeaf,
  swapLeaves,
  treeFromLayout,
  type SerializedNode,
} from "./split-tree";

describe("serializeTree", () => {
  it("drops pane ids and keeps structure + ratios", () => {
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    expect(serializeTree(tree)).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.5,
      first: { type: "leaf" },
      second: {
        type: "split",
        direction: "column",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
    });
  });
});

describe("treeFromLayout", () => {
  const layout: SerializedNode = {
    type: "split",
    direction: "row",
    ratio: 0.3,
    first: { type: "leaf" },
    second: {
      type: "split",
      direction: "column",
      ratio: 0.7,
      first: { type: "leaf" },
      second: { type: "leaf" },
    },
  };

  it("assigns pane ids to leaves left-to-right", () => {
    const tree = treeFromLayout(layout, [10, 20, 30]);
    expect(leafIds(tree)).toEqual([10, 20, 30]);
  });

  it("round-trips through serializeTree, preserving ratios", () => {
    expect(serializeTree(treeFromLayout(layout, [1, 2, 3]))).toEqual(layout);
  });

  it("throws when the id count does not match the leaf count", () => {
    expect(() => treeFromLayout(layout, [1, 2])).toThrow();
    expect(() => treeFromLayout(layout, [1, 2, 3, 4])).toThrow();
  });
});

describe("movePane", () => {
  // Two panes side by side in a row: { split row, a: leaf 1, b: leaf 2 }
  const twoRow = splitLeaf(leaf(1), 1, 2, "row");

  it("docks source to the LEFT of target → row, source in branch a", () => {
    expect(movePane(twoRow, 1, 2, "left")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(2),
    });
  });

  it("docks source to the RIGHT of target → row, source in branch b", () => {
    expect(movePane(twoRow, 1, 2, "right")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(2),
      b: leaf(1),
    });
  });

  it("docks source to the TOP of target → column, source in branch a", () => {
    expect(movePane(twoRow, 1, 2, "top")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(2),
    });
  });

  it("docks source to the BOTTOM of target → column, source in branch b", () => {
    expect(movePane(twoRow, 1, 2, "bottom")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(2),
      b: leaf(1),
    });
  });

  it("collapses the source's parent split after removal", () => {
    // row( leaf 1, column( leaf 2, leaf 3 ) )
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    // Removing leaf 1 collapses the outer row into column(2,3); dock 1 to the right of 3.
    expect(movePane(tree, 1, 3, "right")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(2),
      b: {
        kind: "split",
        dir: "row",
        ratio: 0.5,
        a: leaf(3),
        b: leaf(1),
      },
    });
  });

  it("returns the same tree reference when source === target", () => {
    expect(movePane(twoRow, 1, 1, "left")).toBe(twoRow);
  });

  it("returns the same tree reference when an id is not in the tree", () => {
    expect(movePane(twoRow, 99, 2, "left")).toBe(twoRow);
    expect(movePane(twoRow, 1, 99, "left")).toBe(twoRow);
  });

  it("does not mutate the original tree", () => {
    const snapshot = JSON.parse(JSON.stringify(twoRow));
    movePane(twoRow, 1, 2, "bottom");
    expect(twoRow).toEqual(snapshot);
  });
});

describe("swapLeaves", () => {
  // Two panes side by side: { split row, a: leaf 1, b: leaf 2 }
  const twoRow = splitLeaf(leaf(1), 1, 2, "row");

  it("swaps two leaves, keeping dir/ratio and shape", () => {
    const tree = setRatio(twoRow, [], 0.3); // ratio must survive the swap
    expect(swapLeaves(tree, 1, 2)).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.3,
      a: leaf(2),
      b: leaf(1),
    });
  });

  it("swaps only the two target leaves in a nested tree", () => {
    // row( leaf 1, column( leaf 2, leaf 3 ) )
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    // Swap 1 and 3 → row( leaf 3, column( leaf 2, leaf 1 ) ); leaf 2 untouched.
    expect(swapLeaves(tree, 1, 3)).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(3),
      b: {
        kind: "split",
        dir: "column",
        ratio: 0.5,
        a: leaf(2),
        b: leaf(1),
      },
    });
  });

  it("returns the same tree reference when idA === idB", () => {
    expect(swapLeaves(twoRow, 1, 1)).toBe(twoRow);
  });

  it("returns the same tree reference when an id is not in the tree", () => {
    expect(swapLeaves(twoRow, 1, 99)).toBe(twoRow);
    expect(swapLeaves(twoRow, 99, 2)).toBe(twoRow);
  });

  it("does not mutate the original tree", () => {
    const snapshot = JSON.parse(JSON.stringify(twoRow));
    swapLeaves(twoRow, 1, 2);
    expect(twoRow).toEqual(snapshot);
  });
});

describe("countLeaves", () => {
  it("counts leaves of nested layouts", () => {
    expect(countLeaves({ type: "leaf" })).toBe(1);
    expect(
      countLeaves({
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      }),
    ).toBe(2);
  });
});

describe("expandForPane", () => {
  it("returns a single leaf unchanged by reference", () => {
    const tree = leaf(1);
    expect(expandForPane(tree, 1, 0.65)).toBe(tree);
  });

  it("expands branch a to minRatio when the pane is in a", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row"); // ratio 0.5, pane 1 in a
    const result = expandForPane(tree, 1, 0.65);
    expect(result).toMatchObject({ kind: "split", ratio: 0.65 });
  });

  it("shrinks branch a to 1 - minRatio when the pane is in b", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row"); // pane 2 in b
    const result = expandForPane(tree, 2, 0.65);
    expect(result).toMatchObject({ kind: "split", ratio: 1 - 0.65 });
  });

  it("overrides ratios along the whole path in a nested tree", () => {
    // root(row): a = leaf(1), b = split(column): a = leaf(2), b = leaf(3)
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    const result = expandForPane(tree, 3, 0.65);
    if (result.kind !== "split" || result.b.kind !== "split") {
      throw new Error("expected nested split");
    }
    expect(result.ratio).toBeCloseTo(0.35); // pane 3 in b of root
    expect(result.b.ratio).toBeCloseTo(0.35); // pane 3 in b of inner split
    expect(result.a).toBe(tree.kind === "split" ? tree.a : tree); // off-path branch by reference
  });

  it("keeps a ratio that already satisfies minRatio", () => {
    const base = splitLeaf(leaf(1), 1, 2, "row");
    const tree = setRatio(base, [], 0.8); // branch a already at 0.8 ≥ 0.65
    expect(expandForPane(tree, 1, 0.65)).toBe(tree); // nothing changes → same reference
  });

  it("returns the same reference when paneId is not in the tree", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    expect(expandForPane(tree, 99, 0.65)).toBe(tree);
  });

  it("never mutates the input tree", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    const before = JSON.stringify(tree);
    expandForPane(tree, 1, 0.65);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe("ratioEntries", () => {
  it("returns an empty list for a single leaf", () => {
    expect(ratioEntries(leaf(1))).toEqual([]);
  });

  it("lists path and ratio for every split, root first", () => {
    // root(row, 0.3): a = leaf(1), b = split(column, 0.7): a = leaf(2), b = leaf(3)
    const tree = treeFromLayout(
      {
        type: "split",
        direction: "row",
        ratio: 0.3,
        first: { type: "leaf" },
        second: {
          type: "split",
          direction: "column",
          ratio: 0.7,
          first: { type: "leaf" },
          second: { type: "leaf" },
        },
      },
      [1, 2, 3],
    );
    expect(ratioEntries(tree)).toEqual([
      { path: [], ratio: 0.3 },
      { path: ["b"], ratio: 0.7 },
    ]);
  });

  it("prefixes nested paths on both branches", () => {
    // root: a = split, b = split
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 1, 3, "column"); // splits leaf 1 inside branch a
    tree = splitLeaf(tree, 2, 4, "column"); // splits leaf 2 inside branch b
    expect(ratioEntries(tree)).toEqual([
      { path: [], ratio: 0.5 },
      { path: ["a"], ratio: 0.5 },
      { path: ["b"], ratio: 0.5 },
    ]);
  });
});

describe("dockNewPane", () => {
  it("puts the new pane in branch a for a left dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "left")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(9),
      b: leaf(1),
    });
  });

  it("puts the new pane in branch b for a right dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "right")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(9),
    });
  });

  it("puts the new pane in branch a for a top dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "top")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(9),
      b: leaf(1),
    });
  });

  it("puts the new pane in branch b for a bottom dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "bottom")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(9),
    });
  });

  it("differs from splitLeaf on the two edges that invert", () => {
    // The discriminator. splitLeaf always appends to branch b, so it agrees
    // on right/bottom and is WRONG on left/top — which is why a drop path
    // that reaches for it produces an overlay that lies.
    const viaSplit = splitLeaf(leaf(1), 1, 9, "row");
    expect(dockNewPane(leaf(1), 1, 9, "right")).toEqual(viaSplit);
    expect(dockNewPane(leaf(1), 1, 9, "left")).not.toEqual(viaSplit);
  });

  it("docks onto the correct leaf inside a nested tree", () => {
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    // tree: row(a: 1, b: column(a: 2, b: 3))
    expect(dockNewPane(tree, 3, 9, "top")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(1),
      b: {
        kind: "split",
        dir: "column",
        ratio: 0.5,
        a: leaf(2),
        b: {
          kind: "split",
          dir: "column",
          ratio: 0.5,
          a: leaf(9),
          b: leaf(3),
        },
      },
    });
  });

  it("returns the tree BY REFERENCE when the target is not in it", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    // Same convention as movePane: identity means "nothing happened", and the
    // caller must treat it as a failed adopt rather than a completed one.
    expect(dockNewPane(tree, 99, 9, "left")).toBe(tree);
  });

  it("does not mutate the input tree", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    const before = JSON.stringify(tree);
    dockNewPane(tree, 2, 9, "left");
    expect(JSON.stringify(tree)).toBe(before);
  });
});
