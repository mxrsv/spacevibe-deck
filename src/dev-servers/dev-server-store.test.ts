import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ROOT_LENGTH, MAX_ROOTS } from "../../electron/dev-servers/roots";
import { MAX_SENDABLE_ROOT_LENGTH, MAX_SENDABLE_ROOTS } from "./dev-server-roots";
import { createDevServerStore, SNAPSHOT_POLL_INTERVAL_MS } from "./dev-server-store";
import type {
  DevServerCapability,
  DevServerHost,
  DevServerRootsReply,
  DevServerRow,
  DevServerSnapshot,
} from "./dev-server-types";

const AVAILABLE: DevServerCapability = { available: true };
const UNAVAILABLE: DevServerCapability = {
  available: false,
  reason: "unsupported-platform",
  platform: "win32",
};

function row(id: string, overrides: Partial<DevServerRow> = {}): DevServerRow {
  return {
    id,
    instanceToken: `token-${id}`,
    workspacePath: "/work/app",
    displayRoot: "/work/app",
    port: 5173,
    bindings: [{ family: "IPv4", address: "127.0.0.1" }],
    sharedEndpoint: false,
    observedAt: 1,
    liveness: "running",
    stoppedAt: null,
    protocol: "http",
    url: "http://127.0.0.1:5173/",
    identificationError: null,
    ...overrides,
  };
}

function snap(
  generation: number,
  sequence: number,
  rows: readonly DevServerRow[] = [],
  capability: DevServerCapability = AVAILABLE,
): DevServerSnapshot {
  return {
    generation,
    sequence,
    observedAt: 1,
    capability,
    completeness: "complete",
    metadata: "complete",
    rows,
    diagnostics: [],
    rootDiagnostics: [],
  };
}

function reply(
  generation: number,
  capability: DevServerCapability = AVAILABLE,
): DevServerRootsReply {
  return { capability, applied: true, generation, rootDiagnostics: [] };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeHost() {
  const host = {
    setRoots: vi.fn<DevServerHost["setRoots"]>(),
    snapshot: vi.fn<DevServerHost["snapshot"]>(),
    release: vi.fn<DevServerHost["release"]>(),
    resolve: vi.fn<DevServerHost["resolve"]>(),
  };
  host.setRoots.mockResolvedValue(reply(1));
  host.snapshot.mockResolvedValue(snap(1, 1));
  host.release.mockResolvedValue(undefined);
  return host;
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dev-server-store registration", () => {
  it("never sends main a root it would reject, nor more than it accepts", async () => {
    expect([MAX_SENDABLE_ROOTS, MAX_SENDABLE_ROOT_LENGTH]).toEqual([MAX_ROOTS, MAX_ROOT_LENGTH]);
    const host = fakeHost();
    const store = createDevServerStore(host);
    const valid = Array.from(
      { length: MAX_ROOTS + 5 },
      (_, i) => `/ok/${String(i).padStart(3, "0")}`,
    );

    store.start(["relative", "/bad\0nul", `/${"a".repeat(MAX_ROOT_LENGTH)}`, "", ...valid]);
    await settle();

    const sent = host.setRoots.mock.calls[0]?.[0] ?? [];
    expect(sent).toHaveLength(MAX_ROOTS);
    expect(sent).toEqual(valid.slice(0, MAX_ROOTS));
    expect(store.error.value).toBeNull();
  });

  it("releases instead of registering when none of the roots are sendable", async () => {
    const host = fakeHost();
    const store = createDevServerStore(host);

    store.start(["relative", ""]);
    await settle();

    expect(host.setRoots).not.toHaveBeenCalled();
    expect(store.snapshot.value).toBeNull();
  });

  it("registers the sorted, deduplicated union of consumer roots and reads a snapshot", async () => {
    const host = fakeHost();
    host.snapshot.mockResolvedValue(snap(1, 1, [row("a")]));
    const store = createDevServerStore(host);

    store.start(["/b", "/a"]);
    store.start(["/a", "/c"]);
    await settle();

    expect(host.setRoots).toHaveBeenLastCalledWith(["/a", "/b", "/c"]);
    expect(store.observing.value).toBe(true);
    expect(store.capability.value).toEqual(AVAILABLE);
    expect(store.snapshot.value?.rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("does not re-register when the union is unchanged", async () => {
    const host = fakeHost();
    const store = createDevServerStore(host);
    const first = store.start(["/a"]);
    store.start(["/a"]);
    await settle();
    await first.updateRoots(["/a"]);

    expect(host.setRoots).toHaveBeenCalledTimes(1);
  });

  it("surfaces root diagnostics from the registration reply", async () => {
    const host = fakeHost();
    host.setRoots.mockResolvedValue({
      ...reply(1),
      rootDiagnostics: [{ code: "not-found", root: "/gone", message: "missing" }],
    });
    const store = createDevServerStore(host);
    store.start(["/gone"]);
    await settle();

    expect(store.rootDiagnostics.value).toEqual([
      { code: "not-found", root: "/gone", message: "missing" },
    ]);
  });

  it("does not register an empty root set and registers once roots arrive", async () => {
    const host = fakeHost();
    const store = createDevServerStore(host);
    const observer = store.start([]);
    await settle();
    expect(host.setRoots).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_POLL_INTERVAL_MS * 3);
    expect(host.snapshot).not.toHaveBeenCalled();

    await observer.updateRoots(["/a"]);
    expect(host.setRoots).toHaveBeenCalledWith(["/a"]);
  });

  it("releases and clears state when roots become empty", async () => {
    const host = fakeHost();
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();
    expect(store.snapshot.value).not.toBeNull();

    await observer.updateRoots([]);

    expect(host.release).toHaveBeenCalledTimes(1);
    expect(store.snapshot.value).toBeNull();
    expect(store.observing.value).toBe(true);
  });
});

describe("dev-server-store reference counting and polling", () => {
  it("polls cached snapshots only while observed and releases on the last stop", async () => {
    const host = fakeHost();
    const store = createDevServerStore(host);
    const first = store.start(["/a"]);
    const second = store.start(["/b"]);
    await settle();
    host.snapshot.mockClear();

    await vi.advanceTimersByTimeAsync(SNAPSHOT_POLL_INTERVAL_MS * 2);
    expect(host.snapshot).toHaveBeenCalledTimes(2);

    await first.stop();
    expect(host.release).not.toHaveBeenCalled();
    expect(host.setRoots).toHaveBeenLastCalledWith(["/b"]);

    await second.stop();
    expect(host.release).toHaveBeenCalledTimes(1);
    expect(store.observing.value).toBe(false);
    expect(store.snapshot.value).toBeNull();

    host.snapshot.mockClear();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_POLL_INTERVAL_MS * 5);
    expect(host.snapshot).not.toHaveBeenCalled();
  });

  it("stop is idempotent and a stopped observer cannot change roots", async () => {
    const host = fakeHost();
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    await observer.stop();
    await observer.stop();
    await observer.updateRoots(["/z"]);
    await observer.refresh();

    expect(host.release).toHaveBeenCalledTimes(1);
    expect(host.setRoots).toHaveBeenCalledTimes(1);
  });

  it("does not poll when the capability is unavailable", async () => {
    const host = fakeHost();
    host.setRoots.mockResolvedValue(reply(0, UNAVAILABLE));
    host.snapshot.mockResolvedValue(snap(0, 0, [], UNAVAILABLE));
    const store = createDevServerStore(host);
    store.start(["/a"]);
    await settle();
    host.snapshot.mockClear();

    await vi.advanceTimersByTimeAsync(SNAPSHOT_POLL_INTERVAL_MS * 5);

    expect(store.capability.value).toEqual(UNAVAILABLE);
    expect(host.snapshot).not.toHaveBeenCalled();
  });

  it("distinguishes available-but-empty from unavailable", async () => {
    const host = fakeHost();
    const store = createDevServerStore(host);
    store.start(["/a"]);
    await settle();

    expect(store.capability.value).toEqual(AVAILABLE);
    expect(store.snapshot.value?.rows).toEqual([]);
  });

  it("releases an interest that registered after the last consumer already stopped", async () => {
    const host = fakeHost();
    const pending = deferred<DevServerRootsReply>();
    host.setRoots.mockReturnValue(pending.promise);
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    const stopped = observer.stop();
    expect(host.release).not.toHaveBeenCalled();
    pending.resolve(reply(1));
    await stopped;

    expect(host.release).toHaveBeenCalledTimes(1);
    expect(store.snapshot.value).toBeNull();
  });
});

describe("dev-server-store ordering and stale replies", () => {
  it("serializes root changes: the second registration waits for the first", async () => {
    const host = fakeHost();
    const firstReply = deferred<DevServerRootsReply>();
    host.setRoots.mockReturnValueOnce(firstReply.promise);
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    const second = observer.updateRoots(["/a", "/b"]);
    await settle();
    expect(host.setRoots).toHaveBeenCalledTimes(1);

    host.setRoots.mockResolvedValueOnce(reply(2));
    host.snapshot.mockResolvedValue(snap(2, 5));
    firstReply.resolve(reply(1));
    await second;

    expect(host.setRoots.mock.calls.map(([roots]) => roots)).toEqual([["/a"], ["/a", "/b"]]);
    expect(store.snapshot.value?.generation).toBe(2);
  });

  it("discards a snapshot for another generation", async () => {
    const host = fakeHost();
    host.snapshot.mockResolvedValue(snap(1, 4, [row("keep")]));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    host.snapshot.mockResolvedValue(snap(0, 9, [row("old-roots")]));
    await observer.refresh();
    host.snapshot.mockResolvedValue(snap(7, 9, [row("future")]));
    await observer.refresh();

    expect(store.snapshot.value?.rows.map((r) => r.id)).toEqual(["keep"]);
  });

  it("discards a lower sequence but accepts an equal one with changed rows", async () => {
    const host = fakeHost();
    host.snapshot.mockResolvedValue(snap(1, 5, [row("a")]));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    host.snapshot.mockResolvedValue(snap(1, 4, [row("late")]));
    await observer.refresh();
    expect(store.snapshot.value?.sequence).toBe(5);
    expect(store.snapshot.value?.rows[0].id).toBe("a");

    host.snapshot.mockResolvedValue(snap(1, 5, [row("a", { liveness: "unknown" })]));
    await observer.refresh();
    expect(store.snapshot.value?.rows[0].liveness).toBe("unknown");
  });

  it("keeps the same snapshot object when a poll returns identical data", async () => {
    const host = fakeHost();
    host.snapshot.mockImplementation(async () => snap(1, 3, [row("a")]));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();
    const before = store.snapshot.value;

    await observer.refresh();

    expect(store.snapshot.value).toBe(before);
  });

  it("accepts a lower sequence after re-registration moves to a new generation", async () => {
    const host = fakeHost();
    host.snapshot.mockResolvedValue(snap(1, 50, [row("a")]));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    host.setRoots.mockResolvedValue(reply(2));
    host.snapshot.mockResolvedValue(snap(2, 3, [row("b")]));
    await observer.updateRoots(["/b"]);

    expect(store.snapshot.value?.rows.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("dev-server-store errors", () => {
  it("keeps the last snapshot when a snapshot read fails and clears the error on recovery", async () => {
    const host = fakeHost();
    host.snapshot.mockResolvedValue(snap(1, 1, [row("a")]));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    host.snapshot.mockRejectedValue(new Error("ipc down"));
    await observer.refresh();
    expect(store.error.value).toEqual({ operation: "snapshot", message: "ipc down" });
    expect(store.snapshot.value?.rows.map((r) => r.id)).toEqual(["a"]);

    host.snapshot.mockResolvedValue(snap(1, 2, [row("a")]));
    await observer.refresh();
    expect(store.error.value).toBeNull();
  });

  it("preserves a registration failure, is not hidden by later reads, and retries on the next poll", async () => {
    const host = fakeHost();
    host.setRoots.mockRejectedValueOnce(new Error("too many roots"));
    const store = createDevServerStore(host);
    store.start(["/a"]);
    await settle();

    expect(store.error.value).toEqual({ operation: "register", message: "too many roots" });
    expect(store.snapshot.value).toBeNull();

    await vi.advanceTimersByTimeAsync(SNAPSHOT_POLL_INTERVAL_MS);

    expect(host.setRoots).toHaveBeenCalledTimes(2);
    expect(store.error.value).toBeNull();
    expect(store.snapshot.value).not.toBeNull();
  });

  it("treats a superseded registration as not applied, not as an error, and retries", async () => {
    const host = fakeHost();
    host.setRoots.mockResolvedValueOnce({ ...reply(0), applied: false });
    const store = createDevServerStore(host);
    store.start(["/a"]);
    await settle();

    expect(store.error.value).toBeNull();
    expect(store.snapshot.value).toBeNull();
    expect(host.snapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SNAPSHOT_POLL_INTERVAL_MS);

    expect(host.setRoots).toHaveBeenCalledTimes(2);
    expect(store.snapshot.value?.generation).toBe(1);
  });

  it("surfaces a structural rejection of the whole call and keeps the previous roots", async () => {
    const host = fakeHost();
    host.snapshot.mockResolvedValue(snap(1, 1, [row("a")]));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    host.setRoots.mockRejectedValue(
      new RangeError("dev_servers_set_roots accepts at most 64 roots"),
    );
    await observer.updateRoots(["/a", "/b"]);

    expect(store.error.value).toEqual({
      operation: "register",
      message: "dev_servers_set_roots accepts at most 64 roots",
    });
    expect(store.snapshot.value?.rows.map((r) => r.id)).toEqual(["a"]);
    expect(store.snapshot.value?.generation).toBe(1);
  });

  it("re-registers when main reports generation 0 (not registered) without an error", async () => {
    const host = fakeHost();
    host.snapshot.mockResolvedValue(snap(1, 1, [row("a")]));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    host.snapshot.mockResolvedValueOnce({
      ...snap(0, 2),
      completeness: "pending",
      metadata: "pending",
    });
    host.setRoots.mockResolvedValue(reply(4));
    host.snapshot.mockResolvedValue(snap(4, 3, [row("b")]));
    await observer.refresh();
    expect(store.error.value).toBeNull();
    expect(store.snapshot.value?.rows.map((r) => r.id)).toEqual(["a"]);

    await observer.refresh();
    expect(host.setRoots).toHaveBeenCalledTimes(2);
    expect(store.snapshot.value?.rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("preserves a release failure after clearing state", async () => {
    const host = fakeHost();
    host.release.mockRejectedValue(new Error("release failed"));
    const store = createDevServerStore(host);
    const observer = store.start(["/a"]);
    await settle();

    await observer.stop();

    expect(store.error.value).toEqual({ operation: "release", message: "release failed" });
    expect(store.snapshot.value).toBeNull();
    expect(store.observing.value).toBe(false);
  });

  it("keeps a malformed-reply message from the facade", async () => {
    const host = fakeHost();
    host.snapshot.mockRejectedValue(new Error("Invalid dev server reply: rows is not an array"));
    const store = createDevServerStore(host);
    store.start(["/a"]);
    await settle();

    expect(store.error.value?.message).toContain("Invalid dev server reply");
    expect(store.snapshot.value).toBeNull();
  });
});

describe("dev-server-store resolve", () => {
  it("passes id and token through and returns the host's answer", async () => {
    const host = fakeHost();
    host.resolve.mockResolvedValue({ status: "stale" });
    const store = createDevServerStore(host);

    await expect(store.resolve("r1", "t1")).resolves.toEqual({ status: "stale" });
    expect(host.resolve).toHaveBeenCalledWith("r1", "t1");
  });

  it("propagates a resolve failure to the caller", async () => {
    const host = fakeHost();
    host.resolve.mockRejectedValue(new Error("nope"));
    const store = createDevServerStore(host);

    await expect(store.resolve("r1", "t1")).rejects.toThrow("nope");
  });
});
