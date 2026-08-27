import { describe, expect, it } from "vitest";
import { createTargetDirectory } from "./create-target";
import type { TreeRow } from "./file-tree";

const dir = (path: string, depth: number): TreeRow => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  directory: true,
  depth,
  expanded: true,
  outOfRoot: false,
});
const file = (path: string, depth: number): TreeRow => ({ ...dir(path, depth), directory: false });

const rows = [dir("/r", 0), dir("/r/src", 1), file("/r/src/index.ts", 2), file("/r/readme.md", 1)];

describe("createTargetDirectory", () => {
  it("creates inside a focused directory", () => {
    expect(createTargetDirectory(rows, "/r/src", "/r")).toBe("/r/src");
  });

  it("creates beside a focused file", () => {
    expect(createTargetDirectory(rows, "/r/src/index.ts", "/r")).toBe("/r/src");
  });

  it("creates in the root when the root row is focused", () => {
    expect(createTargetDirectory(rows, "/r", "/r")).toBe("/r");
  });

  it("creates in the root when nothing is focused", () => {
    expect(createTargetDirectory(rows, null, "/r")).toBe("/r");
  });

  it("creates in the root when the focused path has left the tree", () => {
    expect(createTargetDirectory(rows, "/r/gone/deep.ts", "/r")).toBe("/r");
  });

  it("creates in the root for a symlink that resolves out of it", () => {
    const away: TreeRow = { ...dir("/r/away", 1), outOfRoot: true };
    expect(createTargetDirectory([dir("/r", 0), away], "/r/away", "/r")).toBe("/r");
  });
});
