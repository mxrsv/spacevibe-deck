// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileClient, FileChangedPayload } from "./file-client";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "./file-surface-controller";
import {
  activeFileTab,
  activeWorkspace,
  documentFor,
  fileTabsFor,
  resetFileSurfaces,
  setActiveWorkspace,
} from "./file-surface-store";

const ROOT = "/r";
const FILE = "/r/src/index.ts";

interface Harness {
  readonly controller: FileSurfaceController;
  readonly client: FileClient;
  readonly dirtyPushes: string[][];
  readonly watched: { root: string; directories: string[]; files: string[] }[];
  readonly written: { path: string; text: string; eol: string }[];
  emitChange(event: FileChangedPayload): void;
  setContent(path: string, content: string, mtimeMs?: number): void;
  readonly confirmDiscard: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  const disk = new Map<string, { content: string; mtimeMs: number }>();
  const dirtyPushes: string[][] = [];
  const watched: Harness["watched"] = [];
  const written: Harness["written"] = [];
  let changeHandler: ((event: FileChangedPayload) => void) | null = null;
  const confirmDiscard = vi.fn(async () => true);

  const client: FileClient = {
    async listDir() {
      return [];
    },
    async readFile(_root, path) {
      const entry = disk.get(path);
      if (entry === undefined) {
        return { kind: "refused", reason: "gone" };
      }
      return {
        kind: "ok",
        content: entry.content,
        eol: "lf",
        encoding: "utf-8",
        bytes: entry.content.length,
        mixedEol: false,
        readOnly: false,
        reason: null,
        mtimeMs: entry.mtimeMs,
        size: entry.content.length,
        writable: true,
      };
    },
    async writeFile(_root, path, text, eol) {
      written.push({ path, text, eol });
      const next = { content: text, mtimeMs: (disk.get(path)?.mtimeMs ?? 0) + 100 };
      disk.set(path, next);
      return { path, mtimeMs: next.mtimeMs, size: text.length };
    },
    async statFiles(_root, paths) {
      return paths.map((path) => {
        const entry = disk.get(path);
        return entry === undefined
          ? { path, exists: false, mtimeMs: null, size: null }
          : {
              path,
              exists: true,
              mtimeMs: entry.mtimeMs,
              size: entry.content.length,
            };
      });
    },
    async watchPaths(root, directories, files) {
      watched.push({
        root,
        directories: [...directories],
        files: [...files],
      });
    },
    async setDirtyFiles(paths) {
      dirtyPushes.push([...paths]);
    },
    async listenFileChanged(handler) {
      changeHandler = handler;
      return () => {
        changeHandler = null;
      };
    },
  };

  const controller = createFileSurfaceController({ client, confirmDiscard });
  // `init()` installs the change listener and the focus reconcile — without it
  // every `emitChange` below would go nowhere and the tests would pass for the
  // wrong reason.
  void controller.init();
  return {
    controller,
    client,
    dirtyPushes,
    watched,
    written,
    emitChange: (event) => changeHandler?.(event),
    setContent: (path, content, mtimeMs = 1000) => {
      disk.set(path, { content, mtimeMs });
    },
    confirmDiscard,
  };
}

/** `Array.prototype.at` is ES2022 and this repo's `tsc` targets ES2020. */
function lastOf<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

beforeEach(() => {
  resetFileSurfaces();
});

describe("opening and reading", () => {
  it("opens a preview tab and reads its content", async () => {
    const h = harness();
    h.setContent(FILE, "const a = 1;\n");
    await h.controller.openFile(ROOT, FILE, false);

    expect(fileTabsFor(ROOT).map((t) => [t.path, t.preview])).toEqual([
      [FILE, true],
    ]);
    expect(documentFor(FILE)?.text).toBe("const a = 1;\n");
    expect(activeFileTab.value).toBe(FILE);
    expect(activeWorkspace.value).toBe(ROOT);
  });

  it("records a refusal instead of showing an empty editor", async () => {
    const h = harness();
    await h.controller.openFile(ROOT, FILE, false);
    expect(documentFor(FILE)?.refusal).toBe("gone");
    expect(documentFor(FILE)?.file).toBeNull();
  });

  it("arms the watcher for the active workspace only", async () => {
    const h = harness();
    h.setContent(FILE, "x\n");
    await h.controller.openFile(ROOT, FILE, false);
    const last = h.watched[h.watched.length - 1];
    expect(last.root).toBe(ROOT);
    expect(last.files).toContain(FILE);
  });
});

describe("editing", () => {
  it("promotes a preview on the FIRST edit and pushes the dirty set", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);

    h.controller.setText(FILE, "a changed\n");

    expect(fileTabsFor(ROOT)[0].preview).toBe(false);
    expect(documentFor(FILE)?.dirty).toBe(true);
    expect(lastOf(h.dirtyPushes)).toEqual([FILE]);
  });

  it("goes clean again when the text returns to the baseline", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "edited\n");
    h.controller.setText(FILE, "a\n");

    expect(documentFor(FILE)?.dirty).toBe(false);
    expect(lastOf(h.dirtyPushes)).toEqual([]);
  });

  it("pushes only on transitions, never per keystroke", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    const before = h.dirtyPushes.length;

    h.controller.setText(FILE, "ab\n");
    h.controller.setText(FILE, "abc\n");
    h.controller.setText(FILE, "abcd\n");

    expect(h.dirtyPushes.length).toBe(before + 1);
  });
});

describe("saving", () => {
  it("writes the text with the file's own line ending and clears dirty", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "b\n");

    await h.controller.savePath(FILE);

    expect(h.written).toEqual([{ path: FILE, text: "b\n", eol: "lf" }]);
    expect(documentFor(FILE)?.dirty).toBe(false);
    expect(lastOf(h.dirtyPushes)).toEqual([]);
  });

  it("adopts the saved text as the new baseline", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "b\n");
    await h.controller.savePath(FILE);

    // Same text again is not an edit — the baseline moved with the save.
    h.controller.setText(FILE, "b\n");
    expect(documentFor(FILE)?.dirty).toBe(false);
  });

  it("stays dirty when the write fails, so the guard keeps asking", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "b\n");
    vi.spyOn(h.client, "writeFile").mockRejectedValueOnce(new Error("EACCES"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await h.controller.savePath(FILE);

    expect(documentFor(FILE)?.dirty).toBe(true);
    expect(lastOf(h.dirtyPushes)).toEqual([FILE]);
    error.mockRestore();
  });

  it("does not write a read-only document", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    await h.controller.savePath("/r/never-opened.ts");
    expect(h.written).toEqual([]);
  });
});

describe("external change", () => {
  it("reloads a CLEAN file silently", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);

    h.setContent(FILE, "rewritten by the agent\n", 2000);
    h.emitChange({ path: FILE, kind: "changed", mtimeMs: 2000, size: 24 });
    await vi.waitFor(() =>
      expect(documentFor(FILE)?.text).toBe("rewritten by the agent\n"),
    );
    expect(documentFor(FILE)?.prompt).toBeNull();
  });

  it("raises the bar for a DIRTY file and never auto-decides", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "mine\n");

    h.setContent(FILE, "theirs\n", 2000);
    h.emitChange({ path: FILE, kind: "changed", mtimeMs: 2000, size: 7 });

    expect(documentFor(FILE)?.prompt).toBe("prompt-changed");
    expect(documentFor(FILE)?.text).toBe("mine\n");
  });

  it("marks a CLEAN deleted file gone, keeping the content", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);

    h.emitChange({ path: FILE, kind: "deleted", mtimeMs: null, size: null });

    expect(documentFor(FILE)?.gone).toBe(true);
    expect(documentFor(FILE)?.text).toBe("a\n");
  });

  it("ignores an event for a file nothing has open", async () => {
    const h = harness();
    h.emitChange({ path: "/r/other.ts", kind: "changed", mtimeMs: 1, size: 1 });
    expect(documentFor("/r/other.ts")).toBeUndefined();
  });

  it("Reload discards the user's text for the version on disk", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "mine\n");
    h.setContent(FILE, "theirs\n", 2000);
    h.emitChange({ path: FILE, kind: "changed", mtimeMs: 2000, size: 7 });

    await h.controller.resolve(FILE, "reload");

    expect(documentFor(FILE)?.text).toBe("theirs\n");
    expect(documentFor(FILE)?.dirty).toBe(false);
    expect(documentFor(FILE)?.prompt).toBeNull();
  });

  it("Keep mine keeps the text AND adopts the new stamp, so the bar stays down", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "mine\n");
    h.setContent(FILE, "theirs\n", 2000);
    h.emitChange({ path: FILE, kind: "changed", mtimeMs: 2000, size: 7 });

    await h.controller.resolve(FILE, "keep-mine");
    expect(documentFor(FILE)?.text).toBe("mine\n");
    expect(documentFor(FILE)?.prompt).toBeNull();

    // The very next event for the same on-disk state must not re-raise it.
    h.emitChange({ path: FILE, kind: "changed", mtimeMs: 2000, size: 7 });
    expect(documentFor(FILE)?.prompt).toBeNull();
  });

  it("refuses an answer that does not belong to the bar on screen", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "mine\n");
    h.emitChange({ path: FILE, kind: "deleted", mtimeMs: null, size: null });
    expect(documentFor(FILE)?.prompt).toBe("prompt-deleted");

    // "Keep mine" belongs to the CHANGED bar. Applying it here would silently
    // drop the deleted-file question.
    await h.controller.resolve(FILE, "keep-mine");

    expect(documentFor(FILE)?.prompt).toBe("prompt-deleted");
  });

  it("Save again rewrites a file the agent deleted", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "mine\n");
    h.emitChange({ path: FILE, kind: "deleted", mtimeMs: null, size: null });

    await h.controller.resolve(FILE, "save-again");

    expect(lastOf(h.written)?.text).toBe("mine\n");
    expect(documentFor(FILE)?.dirty).toBe(false);
  });

  it("reconciles missed events by re-stat", async () => {
    // The named mitigation for `fs.watch`'s platform inconsistency: no event
    // is emitted here at all.
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.setContent(FILE, "changed behind our back\n", 5000);

    await h.controller.reconcile();

    await vi.waitFor(() =>
      expect(documentFor(FILE)?.text).toBe("changed behind our back\n"),
    );
  });
});

describe("closing", () => {
  it("asks before discarding unsaved work, and keeps the tab on refusal", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "mine\n");
    h.confirmDiscard.mockResolvedValueOnce(false);

    await h.controller.closePath(ROOT, FILE);

    expect(h.confirmDiscard).toHaveBeenCalledWith([FILE]);
    expect(fileTabsFor(ROOT)).toHaveLength(1);
  });

  it("closes without asking when the file is clean", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);

    await h.controller.closePath(ROOT, FILE);

    expect(h.confirmDiscard).not.toHaveBeenCalled();
    expect(fileTabsFor(ROOT)).toHaveLength(0);
    expect(lastOf(h.dirtyPushes) ?? []).toEqual([]);
  });

  it("clears the dirty entry when a dirty tab is closed on purpose", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "mine\n");

    await h.controller.closePath(ROOT, FILE);

    expect(lastOf(h.dirtyPushes)).toEqual([]);
  });
});

describe("the SurfaceStrip seam", () => {
  it("counts, activates and deactivates the strip's file segment", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    h.setContent("/r/b.ts", "b\n");
    await h.controller.openFile(ROOT, FILE, true);
    await h.controller.openFile(ROOT, "/r/b.ts", true);

    expect(h.controller.count()).toBe(2);
    expect(h.controller.total()).toBe(2);
    expect(h.controller.activeIndex()).toBe(1);

    h.controller.activate(0);
    expect(h.controller.activeIndex()).toBe(0);

    h.controller.deactivate();
    expect(h.controller.activeIndex()).toBe(-1);
    expect(activeFileTab.value).toBeNull();
  });

  it("activates a surface in ANOTHER workspace when the strip segment is empty", async () => {
    // The "last surface, not last tab" case: the window still holds file tabs,
    // just not in the workspace the strip is currently showing.
    const h = harness();
    h.setContent("/a/one.ts", "1\n");
    await h.controller.openFile("/a", "/a/one.ts", true);
    setActiveWorkspace("/b");
    h.controller.deactivate();
    expect(h.controller.count()).toBe(0);
    expect(h.controller.total()).toBe(1);

    h.controller.activate(0);

    expect(activeFileTab.value).toBe("/a/one.ts");
    expect(activeWorkspace.value).toBe("/a");
  });

  it("saves the active surface through the seam", async () => {
    const h = harness();
    h.setContent(FILE, "a\n");
    await h.controller.openFile(ROOT, FILE, false);
    h.controller.setText(FILE, "b\n");

    await h.controller.save();

    expect(lastOf(h.written)?.text).toBe("b\n");
  });

  it("does nothing on save with no file surface active", async () => {
    const h = harness();
    await h.controller.save();
    expect(h.written).toEqual([]);
  });
});
