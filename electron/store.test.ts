import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore, StoreRegistry } from "./store";

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck-store-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("JsonStore", () => {
  it("round-trips values through disk", async () => {
    const file = join(tempDir(), "settings.json");
    const store = new JsonStore(file);
    await store.load();

    store.set("settings", { fontSize: 15 });
    await store.save();

    const reopened = new JsonStore(file);
    await reopened.load();
    expect(reopened.get("settings")).toEqual({ fontSize: 15 });
  });

  it("treats a corrupt file as empty without destroying it", async () => {
    // Overwriting would throw away whatever a user might recover by hand.
    const file = join(tempDir(), "settings.json");
    writeFileSync(file, "{ not json");
    const store = new JsonStore(file);

    await store.load();

    expect(store.get("settings")).toBeUndefined();
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  it("treats a non-object file as empty", async () => {
    const file = join(tempDir(), "settings.json");
    writeFileSync(file, '"a string"');
    const store = new JsonStore(file);

    await store.load();

    expect(store.entries()).toEqual({});
  });

  it("deletes and clears", async () => {
    const store = new JsonStore(join(tempDir(), "s.json"));
    await store.load();
    store.set("a", 1);
    store.set("b", 2);

    store.delete("a");
    expect(store.entries()).toEqual({ b: 2 });

    store.clear();
    expect(store.entries()).toEqual({});
  });

  it("does not mutate the previous snapshot when setting", async () => {
    const store = new JsonStore(join(tempDir(), "s.json"));
    await store.load();
    store.set("a", 1);
    const before = store.entries();

    store.set("b", 2);

    expect(before).toEqual({ a: 1 });
  });

  it("leaves no temp file behind after an atomic write", async () => {
    const dir = tempDir();
    const store = new JsonStore(join(dir, "settings.json"));
    await store.load();
    store.set("k", "v");

    await store.save();

    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir)).toEqual(["settings.json"]);
  });
});

describe("StoreRegistry", () => {
  it("returns the same instance for one file name", async () => {
    const registry = new StoreRegistry(tempDir());

    const first = await registry.open("settings.json");
    const second = await registry.open("settings.json");

    expect(first).toBe(second);
  });

  it("flushes every open store", async () => {
    const dir = tempDir();
    const registry = new StoreRegistry(dir);
    (await registry.open("a.json")).set("x", 1);
    (await registry.open("b.json")).set("y", 2);

    await registry.saveAll();

    expect(JSON.parse(readFileSync(join(dir, "a.json"), "utf8"))).toEqual({ x: 1 });
    expect(JSON.parse(readFileSync(join(dir, "b.json"), "utf8"))).toEqual({ y: 2 });
  });
});

describe("background write failures", () => {
  it("reports a failed background write instead of swallowing it", async () => {
    // The Tauri store plugin discarded this error, "which is how a full disk
    // used to look like a successful write" (settings_merge.rs). A path whose
    // parent is a FILE makes mkdir fail for real.
    const dir = tempDir();
    writeFileSync(join(dir, "blocker"), "i am a file");
    const errors: unknown[] = [];
    const store = new JsonStore(join(dir, "blocker", "s.json"), {
      onError: (error) => errors.push(error),
    });
    await store.load();

    store.set("k", "v");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errors).toHaveLength(1);
  });
});

describe("concurrency and recovery", () => {
  it("returns ONE instance to concurrent opens of the same file", async () => {
    // Awaiting before recording let two callers each build a store: divergent
    // in-memory state, and both writing the same .tmp path so the second
    // rename hit ENOENT.
    const registry = new StoreRegistry(tempDir());

    const [a, b] = await Promise.all([
      registry.open("workspaces.json"),
      registry.open("workspaces.json"),
    ]);

    expect(a).toBe(b);
  });

  it("keeps writing after a transient failure", async () => {
    // `.then()` on a rejected chain re-rejects forever, so one full disk used
    // to stop a store writing for the rest of the run.
    const dir = tempDir();
    const target = join(dir, "sub", "s.json");
    const blocker = join(dir, "sub");
    writeFileSync(blocker, "i am a file, not a directory");
    const errors: unknown[] = [];
    const store = new JsonStore(target, { onError: (e) => errors.push(e) });
    await store.load();

    store.set("k", "first");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toHaveLength(1);

    // Clear the obstruction; the next write must succeed.
    rmSync(blocker);
    store.set("k", "second");
    await store.save();

    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ k: "second" });
  });

  it("flushes healthy stores even when one is failing", async () => {
    // Promise.all is fail-fast, so one bad store used to fire app.exit while
    // the good ones were still mid-write.
    const dir = tempDir();
    writeFileSync(join(dir, "blocked"), "file");
    const registry = new StoreRegistry(dir);
    (await registry.open("good.json")).set("x", 1);
    (await registry.open("blocked/bad.json")).set("y", 2);

    await expect(registry.saveAll()).resolves.toBeUndefined();

    expect(JSON.parse(readFileSync(join(dir, "good.json"), "utf8"))).toEqual({
      x: 1,
    });
  });

  it("lets a later caller install the error reporter", async () => {
    // open() drops a second caller's options, so whichever path opened the
    // file first owned error reporting — often a background patch with none.
    const dir = tempDir();
    writeFileSync(join(dir, "blocked"), "file");
    const registry = new StoreRegistry(dir);
    const store = await registry.open("blocked/s.json");
    const errors: unknown[] = [];

    await registry.setErrorReporter("blocked/s.json", (e) => errors.push(e));
    store.set("k", "v");
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(errors).toHaveLength(1);
  });
});
