import {
  leaf,
  leafIds,
  removeLeaf,
  serializeTree,
  setRatio,
  splitLeaf,
  type Branch,
  type Direction,
  type Path,
  type SerializedNode,
  type TreeNode,
} from "../lib/split-tree";

export const RATIO_MIN = 0.15;
export const RATIO_MAX = 0.85;

/** Editor model: synthetic ids on a real split tree — no PTY is ever spawned. */
export interface MockModel {
  readonly tree: TreeNode;
  readonly cwds: ReadonlyMap<number, string>;
  readonly selectedId: number;
  readonly nextId: number;
}

export interface PresetArtifact {
  readonly layout: SerializedNode;
  readonly cwds?: readonly (string | null)[];
}

export function createMockModel(): MockModel {
  return { tree: leaf(1), cwds: new Map(), selectedId: 1, nextId: 2 };
}

export function splitSelected(model: MockModel, dir: Direction): MockModel {
  const newId = model.nextId;
  return {
    ...model,
    tree: splitLeaf(model.tree, model.selectedId, newId, dir),
    selectedId: newId,
    nextId: newId + 1,
  };
}

export function canRemove(model: MockModel): boolean {
  return leafIds(model.tree).length > 1;
}

export function removeSelected(model: MockModel): MockModel {
  const rest = removeLeaf(model.tree, model.selectedId);
  if (rest === null) {
    return model; // last pane — Remove is disabled
  }
  const cwds = new Map(model.cwds);
  cwds.delete(model.selectedId);
  return { ...model, tree: rest, cwds, selectedId: leafIds(rest)[0] };
}

export function selectPane(model: MockModel, id: number): MockModel {
  return leafIds(model.tree).includes(id)
    ? { ...model, selectedId: id }
    : model;
}

export function moveSelection(model: MockModel, step: 1 | -1): MockModel {
  const ids = leafIds(model.tree);
  const index = ids.indexOf(model.selectedId);
  return {
    ...model,
    selectedId: ids[(index + step + ids.length) % ids.length],
  };
}

/** cwd = null clears back to inherit. */
export function setSelectedCwd(
  model: MockModel,
  cwd: string | null,
): MockModel {
  const cwds = new Map(model.cwds);
  if (cwd === null) {
    cwds.delete(model.selectedId);
  } else {
    cwds.set(model.selectedId, cwd);
  }
  return { ...model, cwds };
}

function clampRatio(ratio: number): number {
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));
}

export function setMockRatio(
  model: MockModel,
  path: Path,
  ratio: number,
): MockModel {
  return { ...model, tree: setRatio(model.tree, path, clampRatio(ratio)) };
}

/** Path of a/b branches from the root to the leaf; null when absent. */
function pathToLeaf(
  node: TreeNode,
  id: number,
  prefix: Path = [],
): Path | null {
  if (node.kind === "leaf") {
    return node.paneId === id ? prefix : null;
  }
  return (
    pathToLeaf(node.a, id, [...prefix, "a"]) ??
    pathToLeaf(node.b, id, [...prefix, "b"])
  );
}

function splitAt(node: TreeNode, path: Path): TreeNode {
  return path.length === 0 || node.kind === "leaf"
    ? node
    : splitAt(path[0] === "a" ? node.a : node.b, path.slice(1));
}

/** Grow (+) or shrink (−) the selected pane's share of its parent split. */
export function nudgeSelected(model: MockModel, delta: number): MockModel {
  const path = pathToLeaf(model.tree, model.selectedId);
  if (path === null || path.length === 0) {
    return model; // single pane — nothing to nudge
  }
  const parentPath = path.slice(0, -1);
  const branch: Branch = path[path.length - 1];
  const parent = splitAt(model.tree, parentPath);
  if (parent.kind !== "split") {
    return model;
  }
  const ratio = branch === "a" ? parent.ratio + delta : parent.ratio - delta;
  return setMockRatio(model, parentPath, ratio);
}

export function toPresetArtifact(model: MockModel): PresetArtifact {
  const cwds = leafIds(model.tree).map((id) => model.cwds.get(id) ?? null);
  return {
    layout: serializeTree(model.tree),
    ...(cwds.some((cwd) => cwd !== null) ? { cwds } : {}),
  };
}
