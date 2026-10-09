import { describe, expect, it } from "vitest";
import { CHANGES, TOTALS, TREE, prunedTree, splitPath } from "./changes-specimens-data";

describe("the changes specimens' fixture", () => {
  it("holds the eight entries CHG1 names, one status each but modified", () => {
    expect(CHANGES).toHaveLength(8);
    const count = (status: string): number =>
      CHANGES.filter((entry) => entry.status === status).length;
    expect(count("modified")).toBe(3);
    for (const status of ["added", "renamed", "deleted", "untracked", "binary"]) {
      expect(count(status)).toBe(1);
    }
  });

  it("totals what the rows say, so no variant can print a number its list contradicts", () => {
    expect(TOTALS).toEqual({ added: 42, removed: 7 });
  });

  it("gives a rename its old path and nothing else", () => {
    const withOld = CHANGES.filter((entry) => entry.oldPath !== undefined);
    expect(withOld.map((entry) => entry.status)).toEqual(["renamed"]);
  });

  it("prunes the tree to changed files and their folders only", () => {
    const kept = new Set(prunedTree().map((node) => node.path));
    for (const entry of CHANGES) {
      expect(kept.has(entry.path)).toBe(true);
      expect(kept.has(splitPath(entry.path).dir) || splitPath(entry.path).dir === "").toBe(true);
    }
    // Every kept node is a changed file or the ancestor of one.
    for (const node of prunedTree()) {
      const changed = CHANGES.some(
        (entry) => entry.path === node.path || entry.path.startsWith(`${node.path}/`),
      );
      expect(changed).toBe(true);
    }
    expect(kept.size).toBeLessThan(TREE.length);
  });
});
