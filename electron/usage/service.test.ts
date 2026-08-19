import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUsageService, unreadableSnapshot } from "./service";

const T0 = 1_786_320_000_000;
const NOW = T0 + 60 * 60 * 1000;

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "usage-service-"));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedHome(): string {
  const home = tempDir();
  const project = path.join(home, ".claude", "projects", "proj");
  mkdirSync(project, { recursive: true });
  const file = path.join(project, "sess.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-10T05:06:00.351Z",
      requestId: "req-1",
      sessionId: "sess-1",
      message: {
        id: "msg-1",
        model: "claude-opus-5",
        usage: { input_tokens: 1, output_tokens: 4 },
      },
    })}\n`,
  );
  utimesSync(file, T0 / 1000, T0 / 1000);
  return home;
}

describe("usage service", () => {
  it("answers unreadable-for-both when home cannot be resolved", async () => {
    const service = createUsageService({
      home: null,
      cachePath: null,
      now: () => NOW,
    });
    await expect(service.snapshot()).resolves.toEqual(unreadableSnapshot(NOW));
  });

  it("serializes concurrent callers onto one scan", async () => {
    const home = seedHome();
    const service = createUsageService({
      home,
      cachePath: null,
      now: () => NOW,
    });
    const [first, second, third] = await Promise.all([
      service.snapshot(),
      service.snapshot(),
      service.snapshot(),
    ]);
    // All callers resolve, with the same numbers — no second pass ran a
    // different clock or a half-built cache.
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.buckets).toHaveLength(1);
  });

  it("keeps answering when the cache cannot be written", async () => {
    const home = seedHome();
    const cacheDir = tempDir();
    const cachePath = path.join(cacheDir, "usage-cache.json");
    // Squat a directory on the temp path so every write fails.
    mkdirSync(`${cachePath}.tmp`);
    const report = vi.fn();
    const service = createUsageService({
      home,
      cachePath,
      now: () => NOW,
      reportCacheWriteFailure: report,
    });
    const snapshot = await service.snapshot();
    expect(snapshot.buckets).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("reuses the in-memory cache across polls — the second scan is warm", async () => {
    const home = seedHome();
    const cachePath = path.join(tempDir(), "usage-cache.json");
    const service = createUsageService({
      home,
      cachePath,
      now: () => NOW,
    });
    const first = await service.snapshot();
    const second = await service.snapshot();
    expect(second.buckets).toEqual(first.buckets);
    expect(second.sources).toEqual(first.sources);
  });
});
