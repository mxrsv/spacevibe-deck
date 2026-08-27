import { describe, expect, it } from "vitest";
import { resolveFocusIndex } from "./tree-focus";
import type { TreeRow } from "./file-tree";

const row = (path: string): TreeRow => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  directory: false,
  depth: 1,
  expanded: false,
  outOfRoot: false,
});

describe("resolveFocusIndex", () => {
  const rows = [row("/r"), row("/r/a"), row("/r/b")];

  it("answers the row that holds the focused path", () => {
    expect(resolveFocusIndex(rows, "/r/b", 0)).toBe(2);
  });

  it("answers the root when nothing is focused", () => {
    expect(resolveFocusIndex(rows, null, 2)).toBe(0);
  });

  it("falls back to the nearest surviving index when the path has left the tree", () => {
    expect(resolveFocusIndex([row("/r")], "/r/gone", 2)).toBe(0);
    expect(resolveFocusIndex(rows, "/r/gone", 7)).toBe(2);
    expect(resolveFocusIndex(rows, "/r/gone", 1)).toBe(1);
  });

  it("answers 0 for an empty tree rather than -1", () => {
    expect(resolveFocusIndex([], "/r/a", 3)).toBe(0);
  });
});
