// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileClient, FileChangedPayload } from "./file-client";
import { createFileSurfaceController, type FileSurfaceController } from "./file-surface-controller";
import { persistError } from "../chrome/events";
import { documentFor, resetFileSurfaces } from "./file-surface-store";

const ROOT = "/r";
const FILE = "/r/file.ts";
type ReadResult = Awaited<ReturnType<FileClient["readFile"]>>;

function contents(content: string, mtimeMs = 1000): ReadResult {
  return {
    kind: "ok",
    content,
    mtimeMs,
    size: content.length,
    bytes: content.length,
    eol: "lf",
    encoding: "utf-8",
    mixedEol: false,
    readOnly: false,
    reason: null,
    writable: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let controller: FileSurfaceController;
let emit: (event: FileChangedPayload) => void;
let disk: string;
let client: FileClient;

beforeEach(async () => {
  resetFileSurfaces();
  persistError.value = null;
  disk = "original";
  client = {
    listDir: vi.fn(async () => []),
    readFile: vi.fn(async () => contents(disk)),
    writeFile: vi.fn(async (_root, path, text) => {
      disk = text;
      return { path, mtimeMs: 3000, size: text.length };
    }),
    statFiles: vi.fn(async () => []),
    watchPaths: vi.fn(async () => {}),
    setDirtyFiles: vi.fn(async () => {}),
    createEntry: vi.fn(async () => ({ path: FILE })),
    listenFileChanged: vi.fn(async (handler) => {
      emit = handler;
      return () => {};
    }),
  };
  controller = createFileSurfaceController({ client, confirmDiscard: async () => true });
  await controller.init();
  await controller.openFile(ROOT, FILE, true);
});

afterEach(() => {
  controller.dispose();
  persistError.value = null;
  vi.restoreAllMocks();
});

function reload() {
  emit({ path: FILE, kind: "changed", mtimeMs: 2000, size: 10 });
}

async function settle() {
  // readDocument runs from the actual event listener without returning its promise.
  await Promise.resolve();
  await Promise.resolve();
}

describe("pending file reads", () => {
  it.each(["content", "refusal", "rejection"] as const)(
    "does not apply stale %s after an edit and save",
    async (outcome) => {
      const pending = deferred<ReadResult>();
      vi.mocked(client.readFile).mockReturnValueOnce(pending.promise);
      reload();
      controller.setText(FILE, "saved mine");
      await controller.savePath(FILE);
      if (outcome === "rejection") pending.reject(new Error("old read failed"));
      else
        pending.resolve(
          outcome === "refusal" ? { kind: "refused", reason: "gone" } : contents("old disk"),
        );
      await settle();

      expect(documentFor(FILE)).toMatchObject({
        text: "saved mine",
        dirty: false,
        refusal: null,
        prompt: null,
        file: { content: "saved mine" },
      });
      await controller.save();
      expect(disk).toBe("saved mine");
      expect(persistError.value).toBeNull();
    },
  );

  it("keeps edited text editable and saveable when a reload rejects", async () => {
    const pending = deferred<ReadResult>();
    vi.mocked(client.readFile).mockReturnValueOnce(pending.promise);
    reload();
    controller.setText(FILE, "unsaved mine");
    pending.reject(new Error("EACCES"));
    await settle();

    expect(documentFor(FILE)).toMatchObject({
      text: "unsaved mine",
      dirty: true,
      refusal: null,
      file: { content: "original", readOnly: false },
    });
    expect(persistError.value).toContain(FILE);
    expect(persistError.value).toContain("EACCES");
    await controller.save();
    expect(disk).toBe("unsaved mine");
  });

  it.each(["content", "refusal", "rejection"] as const)(
    "ignores an older %s after a newer reload succeeds",
    async (outcome) => {
      const pending = deferred<ReadResult>();
      vi.mocked(client.readFile)
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(contents("newest", 4000));
      reload();
      reload();
      await settle();
      if (outcome === "rejection") pending.reject(new Error("stale failure"));
      else
        pending.resolve(
          outcome === "refusal" ? { kind: "refused", reason: "gone" } : contents("old disk"),
        );
      await settle();
      expect(documentFor(FILE)).toMatchObject({
        text: "newest",
        refusal: null,
        file: { content: "newest" },
      });
      expect(persistError.value).toBeNull();
    },
  );

  it.each(["content", "refusal", "rejection"] as const)(
    "ignores %s from a closed document after the same path reopens",
    async (outcome) => {
      const pending = deferred<ReadResult>();
      vi.mocked(client.readFile).mockReturnValueOnce(pending.promise);
      reload();
      await controller.closePath(ROOT, FILE);
      disk = "reopened";
      await controller.openFile(ROOT, FILE, true);
      if (outcome === "rejection") pending.reject(new Error("closed read failed"));
      else
        pending.resolve(
          outcome === "refusal" ? { kind: "refused", reason: "gone" } : contents("old disk"),
        );
      await settle();
      expect(documentFor(FILE)).toMatchObject({
        text: "reopened",
        refusal: null,
        file: { content: "reopened" },
      });
      expect(persistError.value).toBeNull();
    },
  );

  it("ignores a read already pending when a save begins, even before it finishes", async () => {
    const reading = deferred<ReadResult>();
    const writing = deferred<Awaited<ReturnType<FileClient["writeFile"]>>>();
    vi.mocked(client.readFile).mockReturnValueOnce(reading.promise);
    vi.mocked(client.writeFile).mockReturnValueOnce(writing.promise);
    reload();
    const saving = controller.save();
    reading.resolve(contents("old disk"));
    await settle();
    expect(documentFor(FILE)?.text).toBe("original");
    writing.resolve({ path: FILE, mtimeMs: 3000, size: 8 });
    await saving;
    expect(documentFor(FILE)?.file?.content).toBe("original");
  });

  it("ignores a read started during a save when that save finishes first", async () => {
    const reading = deferred<ReadResult>();
    const writing = deferred<Awaited<ReturnType<FileClient["writeFile"]>>>();
    vi.mocked(client.readFile).mockReturnValueOnce(reading.promise);
    vi.mocked(client.writeFile).mockReturnValueOnce(writing.promise);
    const saving = controller.save();
    reload();
    writing.resolve({ path: FILE, mtimeMs: 3000, size: 8 });
    await saving;
    reading.resolve(contents("old disk"));
    await settle();
    expect(documentFor(FILE)).toMatchObject({
      text: "original",
      file: { content: "original" },
      mtimeMs: 3000,
    });
  });

  it("does not apply an older read while the newer read is still pending", async () => {
    const oldRead = deferred<ReadResult>();
    const newRead = deferred<ReadResult>();
    vi.mocked(client.readFile)
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    reload();
    reload();
    oldRead.resolve(contents("old disk"));
    await settle();
    expect(documentFor(FILE)?.text).toBe("original");
    newRead.resolve(contents("new disk", 4000));
    await settle();
    expect(documentFor(FILE)?.text).toBe("new disk");
  });

  it("keeps a clean cached document editable when its reload is refused", async () => {
    vi.mocked(client.readFile).mockResolvedValueOnce({ kind: "refused", reason: "unreadable" });
    reload();
    await settle();
    expect(documentFor(FILE)).toMatchObject({
      text: "original",
      refusal: null,
      file: { readOnly: false },
    });
    expect(persistError.value).toContain(FILE);
    controller.setText(FILE, "recoverable");
    await controller.save();
    expect(disk).toBe("recoverable");
  });

  it("still shows a refusal when the initial read fails without cached content", async () => {
    await controller.closePath(ROOT, FILE);
    vi.mocked(client.readFile).mockRejectedValueOnce(new Error("EACCES"));
    await controller.openFile(ROOT, FILE, true);
    expect(documentFor(FILE)).toMatchObject({ file: null, refusal: "EACCES" });
  });

  it("does not treat cursor movement as a new content revision", async () => {
    const pending = deferred<ReadResult>();
    vi.mocked(client.readFile).mockReturnValueOnce(pending.promise);
    reload();
    controller.setCursor(FILE, 2, 4);
    pending.resolve(contents("new disk"));
    await settle();
    expect(documentFor(FILE)).toMatchObject({ text: "new disk", line: 2, column: 4 });
  });
});
