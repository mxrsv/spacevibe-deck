import type { SerializedNode } from "./split-tree";

/** Depth bound so a corrupt file cannot describe a pathological tree. */
export const MAX_LAYOUT_DEPTH = 8;

/** null = corrupt/foreign shape — callers decide the fallback. */
export function validateLayout(raw: unknown, depth = 0): SerializedNode | null {
  if (typeof raw !== "object" || raw === null || depth > MAX_LAYOUT_DEPTH) {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (node.type === "leaf") {
    return { type: "leaf" };
  }
  if (node.type !== "split") {
    return null;
  }
  if (node.direction !== "row" && node.direction !== "column") {
    return null;
  }
  if (
    typeof node.ratio !== "number" ||
    !Number.isFinite(node.ratio) ||
    node.ratio <= 0 ||
    node.ratio >= 1
  ) {
    return null;
  }
  const first = validateLayout(node.first, depth + 1);
  const second = validateLayout(node.second, depth + 1);
  if (first === null || second === null) {
    return null;
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    first,
    second,
  };
}
