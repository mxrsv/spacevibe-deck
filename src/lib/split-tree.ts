/**
 * Immutable split tree: each node is either a pane (leaf) or a binary
 * split in the row/column direction with `ratio` applied to branch `a`.
 * Every transformation returns a new tree and never mutates the old one.
 */

export type Direction = 'row' | 'column';
export type Branch = 'a' | 'b';
export type Path = readonly Branch[];

export interface LeafNode {
  readonly kind: 'leaf';
  readonly paneId: number;
}

export interface SplitNode {
  readonly kind: 'split';
  readonly dir: Direction;
  readonly ratio: number;
  readonly a: TreeNode;
  readonly b: TreeNode;
}

export type TreeNode = LeafNode | SplitNode;

export function leaf(paneId: number): LeafNode {
  return { kind: 'leaf', paneId };
}

/** Replace leaf `targetId` with a split containing it and the new pane `newId`. */
export function splitLeaf(
  node: TreeNode,
  targetId: number,
  newId: number,
  dir: Direction,
): TreeNode {
  if (node.kind === 'leaf') {
    return node.paneId === targetId
      ? { kind: 'split', dir, ratio: 0.5, a: node, b: leaf(newId) }
      : node;
  }
  return {
    ...node,
    a: splitLeaf(node.a, targetId, newId, dir),
    b: splitLeaf(node.b, targetId, newId, dir),
  };
}

export type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Detach leaf `sourceId` from the tree and dock it onto the `edge` of leaf
 * `targetId`. Returns a new tree; returns the old tree BY REFERENCE when the
 * operation is invalid (source === target, or either id is not in the tree).
 */
export function movePane(node: TreeNode, sourceId: number, targetId: number, edge: Edge): TreeNode {
  if (sourceId === targetId) {
    return node;
  }
  const ids = leafIds(node);
  if (!ids.includes(sourceId) || !ids.includes(targetId)) {
    return node;
  }
  const withoutSource = removeLeaf(node, sourceId);
  if (withoutSource === null) {
    // Cannot happen while target remains, but removeLeaf returns TreeNode | null.
    return node;
  }
  const dir: Direction = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const sourceFirst = edge === 'left' || edge === 'top';
  return dockIntoLeaf(withoutSource, targetId, sourceId, dir, sourceFirst);
}

/**
 * Dock a pane that is NOT YET in this tree onto an `edge` of leaf `targetId`.
 * Returns a new tree; returns the old tree BY REFERENCE when `targetId` is not
 * present.
 *
 * `movePane` cannot serve this case: it requires the source leaf to already be
 * in the tree and returns the tree unchanged otherwise. `splitLeaf` cannot
 * either: it takes a direction rather than an edge and always appends the new
 * pane to branch `b`, so `left` and `top` would land on the wrong side.
 */
export function dockNewPane(node: TreeNode, targetId: number, newId: number, edge: Edge): TreeNode {
  if (!leafIds(node).includes(targetId)) {
    return node;
  }
  const dir: Direction = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const newFirst = edge === 'left' || edge === 'top';
  return dockIntoLeaf(node, targetId, newId, dir, newFirst);
}

/** Replace leaf `targetId` with a new split holding it and pane `sourceId` (source in branch a when `sourceFirst`). */
function dockIntoLeaf(
  node: TreeNode,
  targetId: number,
  sourceId: number,
  dir: Direction,
  sourceFirst: boolean,
): TreeNode {
  if (node.kind === 'leaf') {
    if (node.paneId !== targetId) {
      return node;
    }
    const source = leaf(sourceId);
    return {
      kind: 'split',
      dir,
      ratio: 0.5,
      a: sourceFirst ? source : node,
      b: sourceFirst ? node : source,
    };
  }
  return {
    ...node,
    a: dockIntoLeaf(node.a, targetId, sourceId, dir, sourceFirst),
    b: dockIntoLeaf(node.b, targetId, sourceId, dir, sourceFirst),
  };
}

/** Remove a leaf — its parent split collapses into the remaining branch. Returns null when the tree becomes empty. */
export function removeLeaf(node: TreeNode, paneId: number): TreeNode | null {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? null : node;
  }
  const a = removeLeaf(node.a, paneId);
  const b = removeLeaf(node.b, paneId);
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  if (a === node.a && b === node.b) {
    return node;
  }
  return { ...node, a, b };
}

/** Swap a leaf's id (used when respawning a session into the same spot). */
export function replaceLeaf(node: TreeNode, oldId: number, newId: number): TreeNode {
  if (node.kind === 'leaf') {
    return node.paneId === oldId ? leaf(newId) : node;
  }
  return {
    ...node,
    a: replaceLeaf(node.a, oldId, newId),
    b: replaceLeaf(node.b, oldId, newId),
  };
}

/**
 * Swap the positions of leaves `idA` and `idB`, keeping every split's
 * `dir`/`ratio` and the overall tree shape — only the two pane ids trade
 * places. Returns the old tree BY REFERENCE when the swap is a no-op
 * (idA === idB, or either id is not in the tree) — matches `movePane`.
 */
export function swapLeaves(node: TreeNode, idA: number, idB: number): TreeNode {
  if (idA === idB) {
    return node;
  }
  const ids = leafIds(node);
  if (!ids.includes(idA) || !ids.includes(idB)) {
    return node;
  }
  return swapRec(node, idA, idB);
}

function swapRec(node: TreeNode, idA: number, idB: number): TreeNode {
  if (node.kind === 'leaf') {
    return node.paneId === idA ? leaf(idB) : node.paneId === idB ? leaf(idA) : node;
  }
  return {
    ...node,
    a: swapRec(node.a, idA, idB),
    b: swapRec(node.b, idA, idB),
  };
}

/** Pane ids in left→right, top→bottom order. */
export function leafIds(node: TreeNode): number[] {
  return node.kind === 'leaf' ? [node.paneId] : [...leafIds(node.a), ...leafIds(node.b)];
}

/** Update the ratio of the split at `path` (a/b walk from the root). */
export function setRatio(node: TreeNode, path: Path, ratio: number): TreeNode {
  if (node.kind === 'leaf') {
    return node;
  }
  if (path.length === 0) {
    return { ...node, ratio };
  }
  const [head, ...rest] = path;
  return head === 'a'
    ? { ...node, a: setRatio(node.a, rest, ratio) }
    : { ...node, b: setRatio(node.b, rest, ratio) };
}

/**
 * Display-time overlay: return a copy of the tree where every split on the
 * path to leaf `paneId` gives that branch at least `minRatio`. Ratios that
 * already satisfy the minimum are kept (the active pane never shrinks).
 * Returns the node by reference when nothing changes or when `paneId` is
 * not in the tree.
 */
export function expandForPane(node: TreeNode, paneId: number, minRatio: number): TreeNode {
  if (node.kind === 'leaf') {
    return node;
  }
  const inA = leafIds(node.a).includes(paneId);
  const inB = !inA && leafIds(node.b).includes(paneId);
  if (!inA && !inB) {
    return node;
  }
  const ratio = inA ? Math.max(node.ratio, minRatio) : Math.min(node.ratio, 1 - minRatio);
  const a = inA ? expandForPane(node.a, paneId, minRatio) : node.a;
  const b = inB ? expandForPane(node.b, paneId, minRatio) : node.b;
  if (a === node.a && b === node.b && ratio === node.ratio) {
    return node;
  }
  return { ...node, ratio, a, b };
}

export interface RatioEntry {
  readonly path: Path;
  readonly ratio: number;
}

/** Every split's path and ratio, pre-order (root first). Pure — used by LayoutEngine. */
export function ratioEntries(node: TreeNode): RatioEntry[] {
  if (node.kind === 'leaf') {
    return [];
  }
  return [
    { path: [], ratio: node.ratio },
    ...ratioEntries(node.a).map((entry): RatioEntry => ({
      ...entry,
      path: ['a', ...entry.path],
    })),
    ...ratioEntries(node.b).map((entry): RatioEntry => ({
      ...entry,
      path: ['b', ...entry.path],
    })),
  ];
}

export interface SerializedLeaf {
  readonly type: 'leaf';
}

export interface SerializedSplit {
  readonly type: 'split';
  readonly direction: Direction;
  readonly ratio: number;
  readonly first: SerializedNode;
  readonly second: SerializedNode;
}

export type SerializedNode = SerializedLeaf | SerializedSplit;

/** Structure-only snapshot for session persistence — pane ids are dropped. */
export function serializeTree(node: TreeNode): SerializedNode {
  if (node.kind === 'leaf') {
    return { type: 'leaf' };
  }
  return {
    type: 'split',
    direction: node.dir,
    ratio: node.ratio,
    first: serializeTree(node.a),
    second: serializeTree(node.b),
  };
}

export function countLeaves(layout: SerializedNode): number {
  return layout.type === 'leaf' ? 1 : countLeaves(layout.first) + countLeaves(layout.second);
}

/**
 * Rebuild a tree from a serialized layout, assigning `paneIds` to leaves
 * left-to-right. `paneIds` must hold exactly `countLeaves(layout)` ids.
 */
export function treeFromLayout(layout: SerializedNode, paneIds: readonly number[]): TreeNode {
  const [node, used] = buildFromLayout(layout, paneIds, 0);
  if (used !== paneIds.length) {
    throw new Error(`Layout has ${used} leaves but got ${paneIds.length} ids`);
  }
  return node;
}

function buildFromLayout(
  layout: SerializedNode,
  paneIds: readonly number[],
  offset: number,
): [TreeNode, number] {
  if (layout.type === 'leaf') {
    const id = paneIds[offset];
    if (id === undefined) {
      throw new Error(`Layout needs more than ${paneIds.length} pane ids`);
    }
    return [leaf(id), offset + 1];
  }
  const [a, afterA] = buildFromLayout(layout.first, paneIds, offset);
  const [b, afterB] = buildFromLayout(layout.second, paneIds, afterA);
  return [{ kind: 'split', dir: layout.direction, ratio: layout.ratio, a, b }, afterB];
}
