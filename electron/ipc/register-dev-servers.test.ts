import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscovery } from "../dev-servers/discovery";
import type { Binding, NativeScan } from "../dev-servers/native";
import { createProber, type IdentifyResult, type ProbeFunction } from "../dev-servers/protocol";
import { createDevServerService, type DevServerActivity } from "../dev-servers/service";
import { CHANNELS } from "./channels";
import { registerDevServers } from "./register-dev-servers";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  app: null as unknown as import("node:events").EventEmitter,
}));
vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  mocks.app = new Emitter();
  return {
    app: mocks.app,
    BrowserWindow: { getAllWindows: () => [] },
    powerMonitor: new Emitter(),
    ipcMain: {
      handle: (name: string, callback: (event: unknown, payload?: unknown) => unknown) =>
        mocks.handlers.set(name, callback),
    },
  };
});

const V4_ANY: Binding = { family: "IPv4", address: "0.0.0.0" };
const START = "Fri Oct 9 21:54:11 2026";

class FakeSender extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }
}

function scanOf(procs: ReadonlyArray<{ pid: number; port: number; cwd: string }>): NativeScan {
  return {
    capability: { available: true },
    completeness: "complete",
    listeners: procs.map((entry) => ({ pid: entry.pid, port: entry.port, binding: V4_ANY })),
    metadata: "complete",
    cwds: new Map(procs.map((entry) => [entry.pid, entry.cwd])),
    identities: new Map(
      procs.map((entry) => [entry.pid, { pid: entry.pid, ppid: 1, startTime: START }]),
    ),
    diagnostics: [],
  };
}

const MISSING = new Set(["/missing"]);

function setup(platform = "darwin") {
  let scan = scanOf([]);
  const collect = vi.fn(async () => scan);
  const slow = new Map<string, () => void>();
  const discovery = createDiscovery({
    collect,
    clock: () => Date.now(),
    platform,
    salt: "salt",
    realpath: async (target) => {
      if (MISSING.has(target)) {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }
      if (target.startsWith("/slow")) {
        await new Promise<void>((resolve) => slow.set(target, resolve));
      }
      return target;
    },
  });
  const probe = vi.fn(async (): Promise<IdentifyResult> => ({ protocol: "http", status: 200 }));
  const prober = createProber({ probe: probe as unknown as ProbeFunction });
  const activity: DevServerActivity = { isActive: () => true, subscribe: () => () => {} };
  const service = createDevServerService({ discovery, prober, activity });
  const registration = registerDevServers({ service });
  return {
    service,
    registration,
    collect,
    probe,
    slow,
    setScan: (next: NativeScan) => {
      scan = next;
    },
  };
}

function invoke(name: string, sender: FakeSender, payload?: unknown): Promise<any> {
  const handler = mocks.handlers.get(name);
  if (!handler) {
    throw new Error(`Missing handler: ${name}`);
  }
  return Promise.resolve().then(() => handler({ sender }, payload));
}

const setRoots = (sender: FakeSender, roots: unknown) =>
  invoke(CHANNELS.devServersSetRoots, sender, { roots });
const snapshot = (sender: FakeSender) => invoke(CHANNELS.devServersSnapshot, sender);
const release = (sender: FakeSender) => invoke(CHANNELS.devServersRelease, sender);

const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  mocks.handlers.clear();
  mocks.app.removeAllListeners();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("registration", () => {
  it("registers exactly the four flat channels", () => {
    setup();
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "dev_servers_release",
      "dev_servers_resolve",
      "dev_servers_set_roots",
      "dev_servers_snapshot",
    ]);
  });
});

describe("dev_servers_set_roots validation", () => {
  const w1 = new FakeSender(1);

  it.each([
    ["a non-array", "/p"],
    ["a relative path", ["rel/path"]],
    ["a non-string entry", [1]],
    ["an empty root", [""]],
    ["a NUL byte", ["/a\0b"]],
    ["a root over 4096 characters", ["/" + "a".repeat(4096)]],
    ["more than 64 roots", Array.from({ length: 65 }, (_, i) => `/p${i}`)],
  ])("rejects %s and keeps the previous roots", async (_name, roots) => {
    const h = setup();
    const before = await setRoots(w1, ["/p"]);
    await expect(setRoots(w1, roots)).rejects.toThrow(/roots?/i);
    expect((await snapshot(w1)).generation).toBe(before.generation);
    expect(h.service.isObserving()).toBe(true);
  });

  it("rejects a call with no payload", async () => {
    setup();
    await expect(invoke(CHANNELS.devServersSetRoots, w1)).rejects.toBeInstanceOf(TypeError);
  });

  it("reports a missing directory as a diagnostic, not an empty success", async () => {
    const h = setup();
    const result = await setRoots(w1, ["/missing", "/p"]);
    expect(result.rootDiagnostics).toEqual([
      expect.objectContaining({ code: "not-found", root: "/missing" }),
    ]);
    expect(result.capability).toEqual({ available: true });
    expect(result.applied).toBe(true);
    expect(h.service.isObserving()).toBe(true);
  });

  it("treats only-missing roots as zero interest and starts nothing", async () => {
    const h = setup();
    const result = await setRoots(w1, ["/missing"]);
    expect(result.rootDiagnostics).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.collect).not.toHaveBeenCalled();
    expect(h.service.isObserving()).toBe(false);
  });

  it("returns capability unavailable on unsupported platforms", async () => {
    const h = setup("win32");
    const result = await setRoots(w1, ["/p"]);
    expect(result.capability).toMatchObject({ available: false, reason: "unsupported-platform" });
    expect((await snapshot(w1)).capability.available).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.collect).not.toHaveBeenCalled();
  });
});

describe("snapshot", () => {
  it("never starts a scan or an implicit subscription", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    const result = await snapshot(w1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.collect).not.toHaveBeenCalled();
    expect(h.service.isObserving()).toBe(false);
    expect(result).toMatchObject({ generation: 0, rows: [], completeness: "pending" });
  });

  it("filters rows to the asking sender and lets no window steal a row", async () => {
    const h = setup();
    const a = new FakeSender(1);
    const b = new FakeSender(2);
    h.setScan(
      scanOf([
        { pid: 10, port: 3000, cwd: "/p/sub/web" },
        { pid: 11, port: 4000, cwd: "/p/api" },
      ]),
    );
    await setRoots(a, ["/p"]);
    await setRoots(b, ["/p/sub"]);
    await flush();
    const forA = await snapshot(a);
    const forB = await snapshot(b);
    expect(forA.rows.map((row: { port: number }) => row.port)).toEqual([3000, 4000]);
    expect(forA.rows[0].workspacePath).toBe("/p");
    expect(forB.rows.map((row: { port: number }) => row.port)).toEqual([3000]);
    expect(forB.rows[0].workspacePath).toBe("/p/sub");
    expect(h.collect).toHaveBeenCalledTimes(1);
  });

  it("serves the shared observation from a single collector", async () => {
    const h = setup();
    await Promise.all([setRoots(new FakeSender(1), ["/p"]), setRoots(new FakeSender(2), ["/q"])]);
    await flush();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.collect).toHaveBeenCalledTimes(2);
  });
});

describe("root replacement races", () => {
  it("lets the last call win even if an earlier one resolves later", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    h.setScan(scanOf([{ pid: 10, port: 3000, cwd: "/new/app" }]));
    const first = setRoots(w1, ["/slow-old"]);
    await flush();
    const second = await setRoots(w1, ["/new"]);
    h.slow.get("/slow-old")?.();
    const late = await first;
    expect(late.applied).toBe(false);
    expect(second.applied).toBe(true);
    await flush();
    const view = await snapshot(w1);
    expect(view.generation).toBe(second.generation);
    expect(view.rows).toHaveLength(1);
  });

  it("drops a set_roots that resolves after the sender was released", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    const pending = setRoots(w1, ["/slow-x"]);
    await flush();
    await release(w1);
    h.slow.get("/slow-x")?.();
    expect((await pending).applied).toBe(false);
    expect(h.service.isObserving()).toBe(false);
  });
});

describe("release and sender teardown", () => {
  it("release is idempotent and the last release stops observation", async () => {
    const h = setup();
    const a = new FakeSender(1);
    const b = new FakeSender(2);
    await setRoots(a, ["/p"]);
    await setRoots(b, ["/p"]);
    await flush();
    await release(a);
    await release(a);
    expect(h.service.isObserving()).toBe(true);
    await release(b);
    expect(h.service.isObserving()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const calls = h.collect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.collect.mock.calls.length).toBe(calls);
  });

  it("resumes with a fresh generation after a release", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    const first = await setRoots(w1, ["/p"]);
    await release(w1);
    const second = await setRoots(w1, ["/p"]);
    expect(second.generation).toBeGreaterThan(first.generation);
    await flush();
    expect(h.service.isObserving()).toBe(true);
  });

  it("releases when the renderer process dies", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    await setRoots(w1, ["/p"]);
    w1.emit("render-process-gone");
    expect(h.service.isObserving()).toBe(false);
    expect((await snapshot(w1)).generation).toBe(0);
  });

  it("releases on a main-frame navigation, not on a subframe or same-document one", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    await setRoots(w1, ["/p"]);
    w1.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    w1.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    expect(h.service.isObserving()).toBe(true);
    w1.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(h.service.isObserving()).toBe(false);
  });

  it("releases when the window is destroyed and attaches each listener once", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    await setRoots(w1, ["/p"]);
    await setRoots(w1, ["/p"]);
    await snapshot(w1);
    expect(w1.listenerCount("destroyed")).toBe(1);
    expect(w1.listenerCount("render-process-gone")).toBe(1);
    expect(w1.listenerCount("did-start-navigation")).toBe(1);
    w1.emit("destroyed");
    expect(h.service.isObserving()).toBe(false);
  });

  it("keeps the other window's observation when one window goes away", async () => {
    const h = setup();
    const a = new FakeSender(1);
    const b = new FakeSender(2);
    h.setScan(scanOf([{ pid: 10, port: 3000, cwd: "/p/app" }]));
    await setRoots(a, ["/p"]);
    await setRoots(b, ["/p"]);
    await flush();
    a.emit("destroyed");
    expect(h.service.isObserving()).toBe(true);
    expect((await snapshot(b)).rows).toHaveLength(1);
  });
});

describe("dev_servers_resolve", () => {
  it("validates its payload", async () => {
    setup();
    const w1 = new FakeSender(1);
    await setRoots(w1, ["/p"]);
    for (const payload of [
      {},
      { id: 1, instanceToken: "x" },
      { id: "srv-1", instanceToken: "" },
      { id: "srv-1", instanceToken: "x".repeat(129) },
    ]) {
      await expect(invoke(CHANNELS.devServersResolve, w1, payload)).rejects.toThrow(TypeError);
    }
    await expect(invoke(CHANNELS.devServersResolve, w1)).rejects.toBeInstanceOf(TypeError);
  });

  it("returns the verified URL for the sender's row and stale for another window", async () => {
    const h = setup();
    const a = new FakeSender(1);
    const b = new FakeSender(2);
    h.setScan(scanOf([{ pid: 10, port: 3000, cwd: "/p/app" }]));
    await setRoots(a, ["/p"]);
    await setRoots(b, ["/q"]);
    await flush();
    const [row] = (await snapshot(a)).rows;
    const payload = { id: row.id, instanceToken: row.instanceToken };
    expect(await invoke(CHANNELS.devServersResolve, a, payload)).toEqual({
      status: "ready",
      id: row.id,
      url: "http://127.0.0.1:3000/",
      protocol: "http",
    });
    expect(await invoke(CHANNELS.devServersResolve, b, payload)).toEqual({ status: "stale" });
  });
});

describe("quit", () => {
  it("keeps observing through a cancelled quit and disposes at will-quit", async () => {
    const h = setup();
    const w1 = new FakeSender(1);
    h.setScan(scanOf([{ pid: 10, port: 3000, cwd: "/p/app" }]));
    await setRoots(w1, ["/p"]);
    await flush();
    // before-quit is cancelable: the user may answer "keep working".
    mocks.app.emit("before-quit", { preventDefault: () => {} });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.service.isObserving()).toBe(true);
    expect(h.collect).toHaveBeenCalledTimes(2);
    mocks.app.emit("will-quit");
    expect(h.service.isObserving()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.collect).toHaveBeenCalledTimes(2);
    expect((await setRoots(w1, ["/p"])).applied).toBe(false);
  });
});
