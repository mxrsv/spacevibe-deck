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
