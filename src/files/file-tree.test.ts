import { describe, expect, it } from "vitest";
import {
  canExpand,
  EXCLUDED_NAMES,
  flattenTree,
  isHidden,
  isVisible,
  openDirectories,
  sortEntries,
  toggleExpanded,
  visibleEntries,
  type DirEntry,
} from "./file-tree";

function entry(path: string, options: { directory?: boolean; outOfRoot?: boolean } = {}): DirEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return {
    name,
    path,
    directory: options.directory ?? false,
    outOfRoot: options.outOfRoot ?? false,
  };
}

describe("sortEntries", () => {
  it("puts directories first, then files, each alphabetical", () => {
    const sorted = sortEntries([
      entry("/r/zeta.ts"),
      entry("/r/src", { directory: true }),
      entry("/r/alpha.ts"),
      entry("/r/docs", { directory: true }),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["docs", "src", "alpha.ts", "zeta.ts"]);
  });

  it("compares case-insensitively so README sits beside readme", () => {
    const sorted = sortEntries([entry("/r/banana.ts"), entry("/r/Apple.ts"), entry("/r/apple.ts")]);
    expect(sorted.map((e) => e.name)).toEqual(["Apple.ts", "apple.ts", "banana.ts"]);
  });

  it("does not mutate its input", () => {
    const input = [entry("/r/b.ts"), entry("/r/a.ts")];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(["b.ts", "a.ts"]);
  });
});

describe("the exclusion list", () => {
  it("comes from one named constant", () => {
    expect([...EXCLUDED_NAMES].sort()).toEqual([".git", "dist", "node_modules", "target"]);
  });

  it("hides the excluded names and dot-entries by default", () => {
    for (const name of EXCLUDED_NAMES) {
      expect(isVisible(entry(`/r/${name}`, { directory: true }), false)).toBe(false);
    }
    expect(isVisible(entry("/r/.env"), false)).toBe(false);
    expect(isVisible(entry("/r/src.ts"), false)).toBe(true);
  });

  it("reveals dot-entries under showHidden but never the excluded names", () => {
    expect(isVisible(entry("/r/.env"), true)).toBe(true);
    // `.git` is both a dot-entry and excluded: showing it would be huge and
    // meaningless to read in an editor.
    expect(isVisible(entry("/r/.git", { directory: true }), true)).toBe(false);
    expect(isVisible(entry("/r/node_modules", { directory: true }), true)).toBe(false);
  });

  it("recognises dot-entries", () => {
    expect(isHidden(".env")).toBe(true);
    expect(isHidden("env")).toBe(false);
  });
});

describe("visibleEntries", () => {
  it("filters and sorts in one pass", () => {
    const rows = visibleEntries(
      [
        entry("/r/node_modules", { directory: true }),
        entry("/r/b.ts"),
        entry("/r/.env"),
        entry("/r/a", { directory: true }),
      ],
      false,
    );
    expect(rows.map((e) => e.name)).toEqual(["a", "b.ts"]);
  });
});

describe("canExpand", () => {
  it("refuses a symlink that resolves outside the root", () => {
    expect(canExpand(entry("/r/src", { directory: true }))).toBe(true);
    expect(canExpand(entry("/r/away", { directory: true, outOfRoot: true }))).toBe(false);
    expect(canExpand(entry("/r/file.ts"))).toBe(false);
  });
});

describe("flattenTree", () => {
  const listings = new Map<string, readonly DirEntry[]>([
    [
      "/r",
      [
        entry("/r/src", { directory: true }),
        entry("/r/readme.md"),
        entry("/r/node_modules", { directory: true }),
      ],
    ],
    ["/r/src", [entry("/r/src/deep", { directory: true }), entry("/r/src/index.ts")]],
    ["/r/src/deep", [entry("/r/src/deep/leaf.ts")]],
  ]);

  it("renders only the root's children when nothing is expanded", () => {
    const rows = flattenTree("/r", listings, new Set(), false, true);
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ["r", 0],
      ["src", 1],
      ["readme.md", 1],
    ]);
  });

  it("emits the root as row 0 at depth 0, with children at depth 1", () => {
    const rows = flattenTree("/r", listings, new Set(), false, true);
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ["r", 0],
      ["src", 1],
      ["readme.md", 1],
    ]);
    expect(rows[0]).toMatchObject({
      path: "/r",
      directory: true,
      expanded: true,
      outOfRoot: false,
    });
  });

  it("emits exactly one row when the root is collapsed", () => {
    const rows = flattenTree("/r", listings, new Set(["/r/src"]), false, false);
    expect(rows.map((r) => r.name)).toEqual(["r"]);
    expect(rows[0].expanded).toBe(false);
  });

  it("keeps the root row when the root has no listing at all", () => {
    const rows = flattenTree("/r", new Map(), new Set(), false, true);
    expect(rows.map((r) => r.name)).toEqual(["r"]);
  });

  it("descends into expanded directories in display order", () => {
    const rows = flattenTree("/r", listings, new Set(["/r/src"]), false, true);
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ["r", 0],
      ["src", 1],
      ["deep", 2],
      ["index.ts", 2],
      ["readme.md", 1],
    ]);
  });

  it("descends two levels and keeps depth-first order", () => {
    const rows = flattenTree("/r", listings, new Set(["/r/src", "/r/src/deep"]), false, true);
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ["r", 0],
      ["src", 1],
      ["deep", 2],
      ["leaf.ts", 3],
      ["index.ts", 2],
      ["readme.md", 1],
    ]);
  });

  it("shows an expanded directory with no listing yet as a childless row", () => {
    const rows = flattenTree(
      "/r",
      new Map([["/r", [entry("/r/pending", { directory: true })]]]),
      new Set(["/r/pending"]),
      false,
      true,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].expanded).toBe(true);
  });

  it("never walks into a symlink that resolves out of the root", () => {
    const rows = flattenTree(
      "/r",
      new Map<string, readonly DirEntry[]>([
        ["/r", [entry("/r/away", { directory: true, outOfRoot: true })]],
        ["/r/away", [entry("/r/away/secret.txt")]],
      ]),
      new Set(["/r/away"]),
      false,
      true,
    );
    expect(rows.map((r) => r.name)).toEqual(["r", "away"]);
    expect(rows[1].expanded).toBe(false);
  });

  it("terminates on a symlink cycle inside the root", () => {
    const rows = flattenTree(
      "/r",
      new Map<string, readonly DirEntry[]>([
        ["/r", [entry("/r/a", { directory: true })]],
        ["/r/a", [entry("/r", { directory: true })]],
      ]),
      new Set(["/r", "/r/a"]),
      false,
      true,
    );
    // The third entry is the CHILD row named `r`, not a second root row: the
    // `walked` set is what stops the loop.
    expect(rows.map((r) => r.name)).toEqual(["r", "a", "r"]);
  });
});

describe("toggleExpanded", () => {
  it("adds, removes, and never mutates the input set", () => {
    const start = new Set(["/r/a"]);
    const added = toggleExpanded(start, "/r/b");
    expect([...added].sort()).toEqual(["/r/a", "/r/b"]);
    expect([...toggleExpanded(added, "/r/a")]).toEqual(["/r/b"]);
    expect([...start]).toEqual(["/r/a"]);
  });
});

describe("openDirectories", () => {
  it("is the root plus every expanded row — the listing and watch scope", () => {
    const rows = flattenTree(
      "/r",
      new Map<string, readonly DirEntry[]>([
        ["/r", [entry("/r/src", { directory: true })]],
        ["/r/src", [entry("/r/src/deep", { directory: true })]],
      ]),
      new Set(["/r/src", "/r/src/deep"]),
      false,
      true,
    );
    expect(openDirectories(rows, "/r")).toEqual(["/r", "/r/src", "/r/src/deep"]);
  });

  it("names the root once even though the root row is itself expanded", () => {
    const rows = flattenTree(
      "/r",
      new Map<string, readonly DirEntry[]>([
        ["/r", [entry("/r/src", { directory: true })]],
        ["/r/src", [entry("/r/src/deep", { directory: true })]],
      ]),
      new Set(["/r/src", "/r/src/deep"]),
      false,
      true,
    );
    expect(openDirectories(rows, "/r")).toEqual(["/r", "/r/src", "/r/src/deep"]);
  });
});
