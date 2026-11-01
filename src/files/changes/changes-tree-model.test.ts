import { describe, expect, it } from "vitest";
import type { ChangeEntry } from "../../host/git-changes-host";
import { buildChangesTree, visibleRows, type ChangeFolder } from "./changes-tree-model";

const entry = (path: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({
  path,
  status: "modified",
  oldPath: null,
  added: 1,
  removed: 0,
  binary: false,
  counted: true,
  ...over,
});

const labels = (folders: readonly ChangeFolder[]): string[] => folders.map((f) => f.label);
const names = (files: readonly ChangeEntry[]): string[] => files.map((f) => f.path);

describe("buildChangesTree", () => {
  it("rolls added and removed lines and file counts up through nested folders", () => {
    const root = buildChangesTree([
      entry("src/ui/a.ts", { added: 5, removed: 2 }),
      entry("src/ui/deep/b.ts", { added: 3, removed: 1 }),
      entry("src/lib/c.ts", { added: 10, removed: 4 }),
      entry("README.md", { added: 1, removed: 1 }),
    ]);
    expect([root.fileCount, root.added, root.removed]).toEqual([4, 19, 8]);

    const src = root.folders[0];
    expect(src.path).toBe("src");
    expect([src.fileCount, src.added, src.removed]).toEqual([3, 18, 7]);
    const ui = src.folders.find((f) => f.label === "ui") as ChangeFolder;
    expect([ui.fileCount, ui.added, ui.removed]).toEqual([2, 8, 3]);
    const lib = src.folders.find((f) => f.label === "lib") as ChangeFolder;
    expect([lib.fileCount, lib.added, lib.removed]).toEqual([1, 10, 4]);
  });

  it("counts a binary or uncounted file as a file but adds no lines", () => {
    const root = buildChangesTree([
      entry("img/a.png", { binary: true, added: 0, removed: 0 }),
      entry("img/big.bin", { counted: false, added: 99, removed: 99 }),
      entry("img/b.ts", { added: 2, removed: 1 }),
    ]);
    expect([root.fileCount, root.added, root.removed]).toEqual([3, 2, 1]);
  });

  it("folds a folder that holds only one folder into it, and never the root", () => {
    const root = buildChangesTree([entry("src/ui/deep/a.ts"), entry("src/ui/deep/b.ts")]);
    expect(labels(root.folders)).toEqual(["src/ui/deep"]);
    expect(root.folders[0].path).toBe("src/ui/deep");
    expect(names(root.folders[0].files)).toEqual(["src/ui/deep/a.ts", "src/ui/deep/b.ts"]);
  });

  it("stops folding where a folder holds a file or a second folder", () => {
    const root = buildChangesTree([
      entry("src/a.ts"),
      entry("src/ui/b.ts"),
      entry("docs/x/y/z.md"),
      entry("docs/x/w/v.md"),
    ]);
    expect(labels(root.folders)).toEqual(["docs/x", "src"]);
    expect(labels(root.folders[0].folders)).toEqual(["w", "y"]);
    expect(labels(root.folders[1].folders)).toEqual(["ui"]);
    expect(names(root.folders[1].files)).toEqual(["src/a.ts"]);
  });

  it("lists folders before files, each in name order, whatever order the host sent", () => {
    const root = buildChangesTree([
      entry("zeta.ts"),
      entry("b/one.ts"),
      entry("alpha.ts"),
      entry("a/two.ts"),
    ]);
    expect(labels(root.folders)).toEqual(["a", "b"]);
    expect(names(root.files)).toEqual(["alpha.ts", "zeta.ts"]);
  });

  it("is an empty root for no changes", () => {
    const root = buildChangesTree([]);
    expect([root.folders.length, root.files.length, root.fileCount, root.added]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe("visibleRows", () => {
  const root = buildChangesTree([
    entry("src/ui/a.ts"),
    entry("src/ui/deep/b.ts"),
    entry("src/lib/c.ts"),
    entry("README.md"),
  ]);
  const keys = (closed: string[] = []) => visibleRows(root, new Set(closed)).map((r) => r.key);

  it("walks folders then files at each level, in reading order", () => {
    expect(keys()).toEqual([
      "folder:src",
      "folder:src/lib",
      "file:src/lib/c.ts",
      "folder:src/ui",
      "folder:src/ui/deep",
      "file:src/ui/deep/b.ts",
      "file:src/ui/a.ts",
      "file:README.md",
    ]);
  });

  it("skips the rows a closed folder hides and keeps the folder itself", () => {
    expect(keys(["src/ui"])).toEqual([
      "folder:src",
      "folder:src/lib",
      "file:src/lib/c.ts",
      "folder:src/ui",
      "file:README.md",
    ]);
    expect(keys(["src"])).toEqual(["folder:src", "file:README.md"]);
  });
});
