import fs, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreRegistry } from "../store";
import type { BrowserWindow } from "electron";
import { registerStore } from "./register-store";
import { Store } from "../../src/host/store-host";
import {
  flushSessionJournal,
  initSessionJournal,
  resetSessionJournal,
  retainPendingSessionRestore,
} from "../../src/terminal/session-journal";
import type { SessionTab, WindowRecord } from "../../src/lib/session-schema";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => unknown>());
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (event: unknown, payload: unknown) => unknown) =>
      handlers.set(name, handler),
  },
}));
vi.mock("../../src/host/bridge", () => ({
  invoke: async (name: string, payload: unknown) => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Missing IPC handler: ${name}`);
    return structuredClone(await handler({}, structuredClone(payload)));
  },
}));

let root: string;
let stores: StoreRegistry;
let windows: Map<string, BrowserWindow>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "deck-session-index-"));
  stores = new StoreRegistry(root);
  handlers.clear();
  windows = new Map();
  registerStore({ stores, windows, emitTo: () => true });
});
afterEach(async () => {
  resetSessionJournal();
  await stores.saveAll();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("session index across renderer/store IPC", () => {
  it("finds concurrent window writes without a renderer-maintained label index", async () => {
    const [first, second] = await Promise.all([
      Store.load("session.json"),
      Store.load("session.json"),
    ]);
    await Promise.all([
      first.set("window:main", { savedAt: 1 }),
      second.set("window:deck-1", { savedAt: 2 }),
    ]);
    expect(await first.get("windowLabels")).toEqual(["main", "deck-1"]);
    await Promise.all([first.delete("window:main"), second.set("window:deck-2", { savedAt: 3 })]);
    expect(await second.get("windowLabels")).toEqual(["deck-1", "deck-2"]);
  });

  it("recovers records omitted by a stale legacy index and ignores phantom labels", async () => {
    await writeFile(
      join(root, "session.json"),
      JSON.stringify({
        windowLabels: ["missing"],
        "window:main": { savedAt: 1 },
        "window:deck-1": { savedAt: 2 },
        archive: {},
      }),
    );
    const store = await Store.load("session.json");
    expect(await store.get("windowLabels")).toEqual(["main", "deck-1"]);
  });

  it("leaves the same key in other stores unchanged", async () => {
    const store = await Store.load("settings.json");
    await store.set("windowLabels", ["ordinary-value"]);
    expect(await store.get("windowLabels")).toEqual(["ordinary-value"]);
  });
});

function record(names: readonly string[]): WindowRecord {
  return {
    savedAt: 1,
    activeTabIndex: 0,
    files: [],
    activeFileTab: null,
    agentBoardOpen: false,
    agentBoardSurfaceActive: false,
    tabs: names.map((name): SessionTab => ({
      name,
      workspacePath: "/repo",
      layout: { type: "leaf" },
      panes: [{ cwd: "/repo", agent: null, launchCommand: null, taskPrompt: name }],
      dotColor: null,
    })),
  };
}

it("never autosaves an intermediate checkpoint that drops a successfully retried pending tab", async () => {
  const main = record(["A"]);
  const pending = record(["B"]);
  await writeFile(
    join(root, "session.json"),
    JSON.stringify({
      "window:main": main,
      pendingRestore: { "0": pending },
      archive: {},
    }),
  );
  const snapshots: Record<string, unknown>[] = [];
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (to === join(root, "session.json")) snapshots.push(JSON.parse(await readFile(from, "utf8")));
    await rename(from, to);
  });
  await initSessionJournal({
    windowLabel: "main",
    isMain: true,
    capture: () => [...main.tabs, ...pending.tabs],
  });
  retainPendingSessionRestore(new Map(), ["pending-restore:0"]);
  await flushSessionJournal({ strict: true });
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snapshot of snapshots) {
    const saved = (snapshot["window:main"] as WindowRecord).tabs;
    const failed = Object.values(snapshot.pendingRestore as Record<string, WindowRecord>).flatMap(
      (r) => r.tabs,
    );
    expect([...saved, ...failed].map((tab) => tab.name)).toContain("B");
  }
});

it("queued peer saves see only complete old or new checkpoints", async () => {
  const initial = {
    "window:main": record(["A"]),
    pendingRestore: { "0": record(["B"]) },
    archive: {},
    "window:old": record(["old"]),
  };
  await writeFile(join(root, "session.json"), JSON.stringify(initial));
  const [writer, peer] = await Promise.all([
    Store.load("session.json", { autoSave: false }),
    Store.load("session.json"),
  ]);
  const snapshots: Record<string, unknown>[] = [];
  let started!: () => void;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    snapshots.push(JSON.parse(await readFile(from, "utf8")));
    if (snapshots.length === 1) {
      started();
      await blocked;
    }
    await rename(from, to);
  });
  const oldSave = peer.save();
  await entered;
  const next = {
    "window:main": record(["A", "B"]),
    pendingRestore: {},
    archive: { "/repo": { savedAt: 1, tabs: record(["A", "B"]).tabs } },
  };
  const checkpoint = writer.patch(next, ["window:old"]);
  const peerSave = peer.save();
  release();
  await Promise.all([oldSave, checkpoint, peerSave]);
  expect(snapshots).toEqual([initial, next, next]);
  expect(JSON.parse(await readFile(join(root, "session.json"), "utf8"))).toEqual(next);
});

it("a failed checkpoint keeps durable originals and propagates through the facade until retry", async () => {
  const initial = { "window:main": record(["A"]), pendingRestore: { "0": record(["B"]) } };
  await writeFile(join(root, "session.json"), JSON.stringify(initial));
  const writer = await Store.load("session.json", { autoSave: false });
  vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk full"));
  const next = { "window:main": record(["A", "B"]), pendingRestore: {} };
  await expect(writer.patch(next)).rejects.toThrow("disk full");
  expect(JSON.parse(await readFile(join(root, "session.json"), "utf8"))).toEqual(initial);
  await writer.patch(next);
  expect(JSON.parse(await readFile(join(root, "session.json"), "utf8"))).toEqual(next);
});

it("rejects malformed IPC batches and unknown stores before any mutation", async () => {
  const initial = { keep: "original", remove: "untouched" };
  await writeFile(join(root, "session.json"), JSON.stringify(initial));
  const writer = await Store.load("session.json");
  const call = async (payload: unknown) => handlers.get("store_patch")!({}, payload);
  for (const payload of [
    null,
    { file: "../secret.json", values: {}, deleteKeys: [] },
    { file: "settings.json", values: {}, deleteKeys: [] },
    { file: "session.json", values: [], deleteKeys: ["remove"] },
    { file: "session.json", values: { next: 1 }, deleteKeys: ["remove", 42] },
    { file: "session.json", values: { keep: "changed" }, deleteKeys: ["keep"] },
    { file: "session.json", values: { next: undefined }, deleteKeys: ["remove"] },
  ])
    await expect(call(payload)).rejects.toThrow(/store|JSON data/i);
  expect(await writer.get("keep")).toBe("original");
  expect(await writer.get("remove")).toBe("untouched");
  expect(JSON.parse(await readFile(join(root, "session.json"), "utf8"))).toEqual(initial);
});

it("honors an unreadable store's write lock for atomic checkpoints", async () => {
  await writeFile(join(root, "session.json"), "{ damaged");
  const writer = await Store.load("session.json");
  await expect(writer.patch({ "window:main": record(["A"]) })).rejects.toThrow("unreadable");
  expect(await readFile(join(root, "session.json"), "utf8")).toBe("{ damaged");
});

it("consuming boot records preserves a detached label that now belongs to a live peer", async () => {
  const peer = record(["new-peer"]);
  await writeFile(
    join(root, "session.json"),
    JSON.stringify({ "window:deck-1": peer, "window:stale": record(["old"]) }),
  );
  windows.set("deck-1", {} as BrowserWindow);
  const writer = await Store.load("session.json");
  await writer.patch({ "window:main": record(["restored-old-source"]), pendingRestore: {} }, [
    "window:deck-1",
    "window:stale",
  ]);
  expect(await writer.get("window:deck-1")).toEqual(peer);
  expect(await writer.get("window:stale")).toBeUndefined();
  const saved = JSON.parse(await readFile(join(root, "session.json"), "utf8"));
  expect(saved["window:deck-1"]).toEqual(peer);
  expect(saved["window:stale"]).toBeUndefined();
  await expect(
    writer.patch({ "window:deck-1": "invalid overlap" }, ["window:deck-1"]),
  ).rejects.toThrow("Invalid store patch");
  expect(await writer.get("window:deck-1")).toEqual(peer);
});
