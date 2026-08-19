// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fileTabViews } from "./file-tab-views";
import { createFileSurfaceController, type FileSurfaceController } from "./file-surface-controller";
import { openFileTab, resetFileSurfaces, updateDocument } from "./file-surface-store";
import type { FileClient } from "./file-client";
import { resetOpenSequence } from "../lib/open-sequence";

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
  it("projects the active workspace's tabs — name, preview italic flag, active and open order", () => {
    resetOpenSequence();
    openFileTab("/r", "/r/a.ts", { keep: true }); // kept
    openFileTab("/r", "/r/b.ts", { keep: false }); // preview, and now active

    // `openedAt` is what lets the strip interleave these chips with the
    // terminal tabs instead of parking them after every one of them
    // (DL-18.6): the projection carries it, the strip only sorts by it.
    expect(fileTabViews(controller)).toEqual([
      {
        path: "/r/a.ts",
        name: "a.ts",
        dirty: false,
        preview: false,
        active: false,
        openedAt: 1,
      },
      {
        path: "/r/b.ts",
        name: "b.ts",
        dirty: false,
        preview: true,
        active: true,
        openedAt: 2,
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

/**
 * Spec §4.1, driven through the real controller rather than the store
 * directly — `fileTabViews` is the projection `TabBar`/`WorkspaceSidebar`
 * would read, so these lock the shape it sees for the promotion rules, not
 * just the store functions underneath it.
 */
describe("fileTabViews reflects preview/promotion (spec §4.1)", () => {
  it("replacing a clean preview drops the prior tab and never discards work", async () => {
    await controller.openFile("/r", "/r/a.ts", false); // preview
    await controller.openFile("/r", "/r/b.ts", false); // replaces the preview

    const views = fileTabViews(controller);
    expect(views.map((v) => v.path)).toEqual(["/r/b.ts"]);
    expect(views[0]).toMatchObject({ preview: true, active: true });
  });

  it("a double-clicked tab opens already promoted — not the italic preview", async () => {
    await controller.openFile("/r", "/r/a.ts", true); // double-click path

    const [view] = fileTabViews(controller);
    expect(view).toMatchObject({ preview: false, active: true });
  });

  it("the first edit promotes the preview tab in place", async () => {
    // The default `client` at the top of this file refuses every read, so
    // `document.file` never populates and `setText`'s dirty check (which
    // reads `document.file.content`) can never see a change — this test
    // needs a client that actually opens the file, so it gets its own
    // controller rather than borrowing `beforeEach`'s.
    const readableClient: FileClient = {
      ...client,
      readFile: async () => ({
        kind: "ok",
        content: "original\n",
        eol: "lf",
        encoding: "utf-8",
        bytes: 9,
        mixedEol: false,
        readOnly: false,
        reason: null,
        mtimeMs: 1,
        size: 9,
        writable: true,
      }),
    };
    const readableController = createFileSurfaceController({
      client: readableClient,
    });
    await readableController.openFile("/r", "/r/a.ts", false); // preview
    expect(fileTabViews(readableController)[0]).toMatchObject({
      preview: true,
    });

    readableController.setText("/r/a.ts", "changed\n");

    const [view] = fileTabViews(readableController);
    expect(view).toMatchObject({
      path: "/r/a.ts",
      preview: false,
      dirty: true,
    });
  });

  it("a promoted tab survives a later preview click beside it", async () => {
    await controller.openFile("/r", "/r/a.ts", true); // kept
    await controller.openFile("/r", "/r/b.ts", false); // fresh preview beside it

    const views = fileTabViews(controller);
    expect(views.map((v) => v.path)).toEqual(["/r/a.ts", "/r/b.ts"]);
    expect(views[0].preview).toBe(false);
    expect(views[1].preview).toBe(true);
  });
});
