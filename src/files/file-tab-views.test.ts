// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fileTabViews } from "./file-tab-views";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "./file-surface-controller";
import {
  openFileTab,
  resetFileSurfaces,
  updateDocument,
} from "./file-surface-store";
import type { FileClient } from "./file-client";

const client: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused in this test" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  listenFileChanged: async () => () => {},
};

let controller: FileSurfaceController;

beforeEach(() => {
  resetFileSurfaces();
  controller = createFileSurfaceController({ client });
});

describe("fileTabViews", () => {
  it("projects the active workspace's tabs — name, preview italic flag and active", () => {
    openFileTab("/r", "/r/a.ts", { keep: true }); // kept
    openFileTab("/r", "/r/b.ts", { keep: false }); // preview, and now active

    expect(fileTabViews(controller)).toEqual([
      {
        path: "/r/a.ts",
        name: "a.ts",
        dirty: false,
        preview: false,
        active: false,
      },
      {
        path: "/r/b.ts",
        name: "b.ts",
        dirty: false,
        preview: true,
        active: true,
      },
    ]);
  });

  it("marks a tab dirty from its document, not from tab identity", () => {
    openFileTab("/r", "/r/a.ts", { keep: true });
    updateDocument("/r/a.ts", { dirty: true });

    const [view] = fileTabViews(controller);

    expect(view.dirty).toBe(true);
  });

  it("is empty when the active workspace has no open tabs", () => {
    expect(fileTabViews(controller)).toEqual([]);
  });
});
