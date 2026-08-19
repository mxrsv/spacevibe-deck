import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("../host/bridge", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { createMemoryUsageClient, createHostUsageClient } from "./usage-client";
import { EMPTY_USAGE_SNAPSHOT, type UsageSnapshot } from "../lib/usage-snapshot";

const snapshot: UsageSnapshot = {
  scannedAtMs: 1_754_820_000_000,
  buckets: [
    {
      bucketStartMs: 1_754_819_100_000,
      agent: "claude",
      model: "claude-opus-5",
      counters: {
        inputUncached: 10,
        cacheRead: 20,
        cacheCreate5m: 30,
        cacheCreate1h: 40,
        cacheWrite: 0,
        output: 50,
      },
    },
  ],
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1881 },
    { agent: "codex", state: "missing", filesScanned: 0 },
  ],
  skippedLines: 3,
};

describe("createHostUsageClient", () => {
  it("invokes the channel with no payload — the scan takes no renderer input", async () => {
    invoke.mockResolvedValueOnce(snapshot);

    await expect(createHostUsageClient().snapshot()).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("usage_snapshot");
  });
});

describe("createMemoryUsageClient", () => {
  it("answers with the empty snapshot by default", async () => {
    await expect(createMemoryUsageClient().snapshot()).resolves.toEqual(EMPTY_USAGE_SNAPSHOT);
  });

  it("answers with the configured snapshot", async () => {
    await expect(createMemoryUsageClient(snapshot).snapshot()).resolves.toEqual(snapshot);
  });

  it("can be made to fail, so the caller's stale path is testable", async () => {
    const client = createMemoryUsageClient(EMPTY_USAGE_SNAPSHOT, {
      fail: true,
    });

    await expect(client.snapshot()).rejects.toThrow("usage_snapshot failed");
  });
});
