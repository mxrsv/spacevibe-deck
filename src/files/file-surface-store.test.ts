import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  activateFileTab,
  activateTerminalSurface,
  activeFileTab,
  activeStripIndex,
  activeWorkspace,
  closeFileSurface,
  closeWorkspaceSurface,
  dirtyPaths,
  documentFor,
  EMPTY_SURFACE,
  fileTabsFor,
  openFileTab,
  promoteFileTab,
  resetFileSurfaces,
  setActiveWorkspace,
  setListing,
  setShowHidden,
  stripFileTabs,
  surfaceFor,
  toggleDirectory,
  totalFileTabs,
  treeRows,
  updateDocument,
  visibleDirectories,
} from "./file-surface-store";
import type { DirEntry } from "./file-tree";

const dir = (path: string): DirEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  directory: true,
  outOfRoot: false,
});
const file = (path: string): DirEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  directory: false,
  outOfRoot: false,
});

beforeEach(() => {
  resetFileSurfaces();
});

describe("the seam", () => {
  it("imports nothing from tab-manager, and tab-manager imports nothing from it", () => {
    // Spec §2.3: TabManager gains no knowledge of files and the file store
    // gains no knowledge of PTYs. Asserted on the IMPORT statements rather
    // than on the whole text — both files name the other in prose, which is
    // the point of the seam being written down.
    const imports = (source: string): string[] =>
      [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(
      imports(readFileSync("src/files/file-surface-store.ts", "utf8")),
    ).not.toContain("../terminal/tab-manager");
    expect(
      imports(readFileSync("src/terminal/tab-manager.ts", "utf8")).filter(
        (specifier) => specifier.includes("/files/"),
      ),
    ).toEqual([]);
  });
});

describe("keying by workspacePath", () => {
  it("gives an unknown workspace the empty state", () => {
    expect(surfaceFor("/r")).toBe(EMPTY_SURFACE);
  });

  it("gives a null workspace the empty state and NEVER a $HOME fallback", () => {
    expect(surfaceFor(null)).toBe(EMPTY_SURFACE);
    expect(treeRows(null)).toEqual([]);
    expect(visibleDirectories(null)).toEqual([]);
    expect(fileTabsFor(null)).toEqual([]);
  });

  it("keeps two workspaces' state entirely separate", () => {
    openFileTab("/a", "/a/one.ts", { keep: true });
    openFileTab("/b", "/b/two.ts", { keep: true });
    setShowHidden("/a", true);
    expect(fileTabsFor("/a").map((t) => t.path)).toEqual(["/a/one.ts"]);
    expect(fileTabsFor("/b").map((t) => t.path)).toEqual(["/b/two.ts"]);
    expect(surfaceFor("/a").showHidden).toBe(true);
    expect(surfaceFor("/b").showHidden).toBe(false);
  });
});

describe("the tree", () => {
  it("flattens listings through the expansion set", () => {
    setListing("/r", "/r", [dir("/r/src"), file("/r/a.ts")]);
    setListing("/r", "/r/src", [file("/r/src/index.ts")]);
    expect(treeRows("/r").map((r) => r.name)).toEqual(["src", "a.ts"]);
    toggleDirectory("/r", "/r/src");
    expect(treeRows("/r").map((r) => r.name)).toEqual([
      "src",
      "index.ts",
      "a.ts",
    ]);
    expect(visibleDirectories("/r")).toEqual(["/r", "/r/src"]);
    toggleDirectory("/r", "/r/src");
    expect(visibleDirectories("/r")).toEqual(["/r"]);
  });

  it("keeps a collapsed directory's listing cached", () => {
    setListing("/r", "/r", [dir("/r/src")]);
    setListing("/r", "/r/src", [file("/r/src/index.ts")]);
    toggleDirectory("/r", "/r/src");
    toggleDirectory("/r", "/r/src");
    expect(surfaceFor("/r").listings.has("/r/src")).toBe(true);
  });
});

describe("opening file tabs", () => {
  it("opens a click as a preview and a double-click as a kept tab", () => {
    openFileTab("/r", "/r/a.ts", { keep: false });
    expect(fileTabsFor("/r")[0].preview).toBe(true);
    openFileTab("/r", "/r/b.ts", { keep: true });
    expect(fileTabsFor("/r").map((t) => [t.path, t.preview])).toEqual([
      ["/r/b.ts", false],
    ]);
  });

  it("creates the document once and reports whether it must be read", () => {
    expect(openFileTab("/r", "/r/a.ts", { keep: false })).toBe(true);
    expect(documentFor("/r/a.ts")?.workspacePath).toBe("/r");
    expect(openFileTab("/r", "/r/a.ts", { keep: false })).toBe(false);
  });

  it("makes the opened file the active surface and its workspace active", () => {
    openFileTab("/r", "/r/a.ts", { keep: false });
    expect(activeFileTab.value).toBe("/r/a.ts");
    expect(activeWorkspace.value).toBe("/r");
    expect(activeStripIndex()).toBe(0);
  });

  it("promotes on the first edit", () => {
    openFileTab("/r", "/r/a.ts", { keep: false });
    promoteFileTab("/r", "/r/a.ts");
    expect(fileTabsFor("/r")[0].preview).toBe(false);
  });

  it("never replaces a dirty preview", () => {
    openFileTab("/r", "/r/a.ts", { keep: false });
    updateDocument("/r/a.ts", { dirty: true });
    openFileTab("/r", "/r/b.ts", { keep: false });
    expect(fileTabsFor("/r").map((t) => t.path)).toEqual([
      "/r/a.ts",
      "/r/b.ts",
    ]);
    expect(dirtyPaths()).toEqual(["/r/a.ts"]);
  });

  it("disposes the previous preview's document when a clean preview is replaced", () => {
    // Otherwise the evicted document lingers in `fileDocuments` forever: still
    // watched, still reacting to external-change events, for a file no tab
    // shows anymore.
    openFileTab("/r", "/r/a.ts", { keep: false });
    expect(documentFor("/r/a.ts")).toBeDefined();

    openFileTab("/r", "/r/b.ts", { keep: false });

    expect(documentFor("/r/a.ts")).toBeUndefined();
    expect(fileTabsFor("/r").map((t) => t.path)).toEqual(["/r/b.ts"]);
  });

  it("keeps the evicted preview's document if another workspace still holds it open", () => {
    // `fileDocuments` is keyed by absolute path, window-wide (module doc
    // comment) — a path tabbed in a second workspace must survive eviction
    // from the first.
    openFileTab("/r", "/shared.ts", { keep: false });
    openFileTab("/other", "/shared.ts", { keep: true });

    openFileTab("/r", "/r/b.ts", { keep: false });

    expect(documentFor("/shared.ts")).toBeDefined();
  });
});

describe("the active surface", () => {
  it("steps back to a terminal tab without losing the file tabs", () => {
    openFileTab("/r", "/r/a.ts", { keep: true });
    activateTerminalSurface();
    setActiveWorkspace("/r");
    expect(activeFileTab.value).toBeNull();
    expect(activeStripIndex()).toBe(-1);
    expect(stripFileTabs().map((t) => t.path)).toEqual(["/r/a.ts"]);
  });

  it("keeps a workspace's file tabs in the strip after its terminal tab closes", () => {
    // "Last surface, not last tab" (plan T21) has nothing to point at unless
    // the active workspace survives its terminal tabs.
    openFileTab("/r", "/r/a.ts", { keep: true });
    activateTerminalSurface();
    setActiveWorkspace("/r");
    expect(stripFileTabs()).toHaveLength(1);
    expect(totalFileTabs()).toBe(1);
  });

  it("swaps the visible file tabs when the active workspace changes", () => {
    // The named cost of spec §2.1, asserted rather than left implicit.
    openFileTab("/a", "/a/one.ts", { keep: true });
    openFileTab("/b", "/b/two.ts", { keep: true });
    expect(stripFileTabs().map((t) => t.path)).toEqual(["/b/two.ts"]);
    activateTerminalSurface();
    setActiveWorkspace("/a");
    expect(stripFileTabs().map((t) => t.path)).toEqual(["/a/one.ts"]);
  });

  it("reactivates a file tab by path", () => {
    openFileTab("/r", "/r/a.ts", { keep: true });
    openFileTab("/r", "/r/b.ts", { keep: true });
    activateFileTab("/r", "/r/a.ts");
    expect(activeStripIndex()).toBe(0);
  });
});

describe("closing a file tab", () => {
  it("drops the tab and its document, and moves the active surface along", () => {
    openFileTab("/r", "/r/a.ts", { keep: true });
    openFileTab("/r", "/r/b.ts", { keep: true });
    closeFileSurface("/r", "/r/b.ts");
    expect(fileTabsFor("/r").map((t) => t.path)).toEqual(["/r/a.ts"]);
    expect(documentFor("/r/b.ts")).toBeUndefined();
    expect(activeFileTab.value).toBe("/r/a.ts");
  });

  it("leaves no active file surface once the last file tab closes", () => {
    openFileTab("/r", "/r/a.ts", { keep: true });
    closeFileSurface("/r", "/r/a.ts");
    expect(activeFileTab.value).toBeNull();
    expect(totalFileTabs()).toBe(0);
  });

  it("clears the dirty path with the document", () => {
    openFileTab("/r", "/r/a.ts", { keep: true });
    updateDocument("/r/a.ts", { dirty: true });
    closeFileSurface("/r", "/r/a.ts");
    expect(dirtyPaths()).toEqual([]);
  });
});

describe("closing a workspace", () => {
  it("drops every tab and document for that workspace only", () => {
    openFileTab("/a", "/a/one.ts", { keep: true });
    openFileTab("/a", "/a/two.ts", { keep: true });
    openFileTab("/b", "/b/three.ts", { keep: true });

    closeWorkspaceSurface("/a");

    expect(fileTabsFor("/a")).toEqual([]);
    expect(documentFor("/a/one.ts")).toBeUndefined();
    expect(documentFor("/a/two.ts")).toBeUndefined();
    expect(fileTabsFor("/b").map((t) => t.path)).toEqual(["/b/three.ts"]);
    expect(documentFor("/b/three.ts")).toBeDefined();
  });

  it("clears the active file tab when it belonged to the closed workspace", () => {
    openFileTab("/a", "/a/one.ts", { keep: true });
    closeWorkspaceSurface("/a");
    expect(activeFileTab.value).toBeNull();
  });

  it("leaves the active file tab alone when it belongs to a different workspace", () => {
    openFileTab("/a", "/a/one.ts", { keep: true });
    openFileTab("/b", "/b/two.ts", { keep: true });
    closeWorkspaceSurface("/a");
    expect(activeFileTab.value).toBe("/b/two.ts");
  });

  it("is a no-op for a workspace with no surface entry", () => {
    expect(() => closeWorkspaceSurface("/never-opened")).not.toThrow();
    expect(totalFileTabs()).toBe(0);
  });

  it("keeps a path's document alive if it is also open in another workspace", () => {
    openFileTab("/a", "/shared.ts", { keep: true });
    openFileTab("/b", "/shared.ts", { keep: true });
    closeWorkspaceSurface("/a");
    expect(documentFor("/shared.ts")).toBeDefined();
  });
});

describe("totalFileTabs", () => {
  it("counts every workspace's tabs, not just the visible segment", () => {
    openFileTab("/a", "/a/one.ts", { keep: true });
    openFileTab("/b", "/b/two.ts", { keep: true });
    openFileTab("/b", "/b/three.ts", { keep: true });
    expect(totalFileTabs()).toBe(3);
  });
});
