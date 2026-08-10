import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "./usage-store";
import type { UsageClient } from "./usage-client";
import {
  EMPTY_USAGE_SNAPSHOT,
  type UsageSnapshot,
} from "../lib/usage-snapshot";

/** The poll interval, restated here so a change to it fails a test. */
const POLL_MS = 5000;

const first: UsageSnapshot = { ...EMPTY_USAGE_SNAPSHOT, scannedAtMs: 1 };
const second: UsageSnapshot = { ...EMPTY_USAGE_SNAPSHOT, scannedAtMs: 2 };

interface Deferred {
  readonly promise: Promise<UsageSnapshot>;
  resolve(value: UsageSnapshot): void;
}

function deferred(): Deferred {
  let resolve: (value: UsageSnapshot) => void = () => undefined;
  const promise = new Promise<UsageSnapshot>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * A client that hands out queued replies, then repeats the last one. Replies
 * are FACTORIES, not promises: a `Promise.reject` sitting in an array is an
 * unhandled rejection until something consumes it, and vitest reports that as
 * an error even when every test passes.
 */
type Reply = () => Promise<UsageSnapshot>;

function queuedClient(replies: readonly Reply[]): {
  readonly client: UsageClient;
  calls(): number;
} {
  const pending = [...replies];
  let calls = 0;
  return {
    client: {
      snapshot() {
        calls += 1;
        const next = pending.shift();
        return next === undefined ? Promise.resolve(second) : next();
      },
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  stopUsagePolling();
  usageSnapshot.value = null;
  usageStale.value = false;
  usageLoading.value = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startUsagePolling", () => {
  it("fetches once immediately", async () => {
    const { client, calls } = queuedClient([() => Promise.resolve(first)]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls()).toBe(1);
    expect(usageSnapshot.value).toEqual(first);
    expect(usageStale.value).toBe(false);
  });

  it("fetches again on every interval tick", async () => {
    const { client, calls } = queuedClient([
      () => Promise.resolve(first),
      () => Promise.resolve(second),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(calls()).toBe(2);
    expect(usageSnapshot.value).toEqual(second);
  });

  it("is a no-op while already polling — no second timer", async () => {
    const { client, calls } = queuedClient([]);

    startUsagePolling(client);
    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(calls()).toBe(2);
  });

  it("does not stack a second scan on top of one still running", async () => {
    const slow = deferred();
    const { client, calls } = queuedClient([() => slow.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(calls()).toBe(1);

    slow.resolve(first);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toEqual(first);
  });

  it("keeps the last good snapshot and marks it stale when a poll fails", async () => {
    const { client } = queuedClient([
      () => Promise.resolve(first),
      () => Promise.reject(new Error("worker panicked")),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(usageSnapshot.value).toEqual(first);
    expect(usageStale.value).toBe(true);
  });

  it("clears the stale mark once a poll succeeds again", async () => {
    const { client } = queuedClient([
      () => Promise.resolve(first),
      () => Promise.reject(new Error("worker panicked")),
      () => Promise.resolve(second),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(usageStale.value).toBe(false);
    expect(usageSnapshot.value).toEqual(second);
  });

  it("marks a failed cold scan stale without inventing an empty snapshot", async () => {
    const { client } = queuedClient([() => Promise.reject(new Error("panic"))]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toBeNull();
    expect(usageStale.value).toBe(true);
    expect(usageLoading.value).toBe(false);
  });
});

describe("usageLoading", () => {
  it("is true only while the cold scan runs", async () => {
    const cold = deferred();
    const warm = deferred();
    const { client } = queuedClient([() => cold.promise, () => warm.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageLoading.value).toBe(true);

    cold.resolve(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageLoading.value).toBe(false);

    // A later poll must not flash the loading state every five seconds.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(usageLoading.value).toBe(false);

    warm.resolve(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageSnapshot.value).toEqual(second);
  });
});

describe("stopUsagePolling", () => {
  it("stops further polls and is idempotent", async () => {
    const { client, calls } = queuedClient([() => Promise.resolve(first)]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    stopUsagePolling();
    stopUsagePolling();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(calls()).toBe(1);
  });

  it("clears the cold-scan loading flag", async () => {
    const cold = deferred();
    const { client } = queuedClient([() => cold.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageLoading.value).toBe(true);

    stopUsagePolling();

    expect(usageLoading.value).toBe(false);
  });

  it("discards a scan that was still in flight", async () => {
    const orphan = deferred();
    const { client } = queuedClient([() => orphan.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    stopUsagePolling();
    orphan.resolve(first);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toBeNull();
    expect(usageStale.value).toBe(false);
  });

  it("lets a restart fetch immediately instead of waiting out the orphan", async () => {
    const orphan = deferred();
    const { client, calls } = queuedClient([
      () => orphan.promise,
      () => Promise.resolve(second),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    stopUsagePolling();
    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls()).toBe(2);
    expect(usageSnapshot.value).toEqual(second);

    orphan.resolve(first);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toEqual(second);
  });
});
