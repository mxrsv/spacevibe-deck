import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanAll, buildSnapshot } from "./scan";
import { emptyCache } from "./model";

/**
 * The incremental pass: warm-path stat-only polls, shrink and identity
 * rules, the archived-duplicate drop and carry-over — the reconciliation
 * behaviors `src-tauri/src/usage/scan.rs` pins.
 */

const T0 = 1_786_320_000_000; // 2026-08-10T00:00:00Z
const NOW = T0 + 60 * 60 * 1000;

const temps: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "usage-scan-"));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function pin(target: string, atMs: number = T0): void {
  utimesSync(target, atMs / 1000, atMs / 1000);
}

function claudeHome(home: string, lines: string): string {
  const project = path.join(home, ".claude", "projects", "proj");
  mkdirSync(project, { recursive: true });
  const file = path.join(project, "sess.jsonl");
  writeFileSync(file, lines);
  pin(file);
  return file;
}

function assistantLine(id: string, output: number): string {
  return `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-10T05:06:00.351Z",
    requestId: `req-${id}`,
    sessionId: "sess-1",
    message: {
      id: `msg-${id}`,
      model: "claude-opus-5",
      usage: { input_tokens: 1, output_tokens: output },
    },
  })}\n`;
}

describe("scanAll", () => {
  it("reports missing roots as missing and an empty home scans clean", async () => {
    const home = tempHome();
    const outcome = await scanAll(emptyCache(), home, NOW);
    expect(outcome.claude).toBe("missing");
    expect(outcome.codex).toBe("missing");
    const snapshot = buildSnapshot(outcome, NOW);
    expect(snapshot.buckets).toEqual([]);
    expect(snapshot.sources.map((source) => source.state)).toEqual(["missing", "missing"]);
  });

  it("does not reopen an unchanged file, and the changed flag goes quiet", async () => {
    const home = tempHome();
    const file = claudeHome(home, assistantLine("1", 10));
    const first = await scanAll(emptyCache(), home, NOW);
    expect(first.changed).toBe(true);

    // Rewrite the file with DIFFERENT content but identical size and mtime:
    // a warm poll must not open it, so the old numbers survive — the proof
    // that unchanged polls read zero JSONL bytes.
    writeFileSync(file, assistantLine("1", 99));
    pin(file);
    const second = await scanAll(first.cache, home, NOW);
    expect(second.changed).toBe(false);
    expect(buildSnapshot(second, NOW).buckets).toEqual(buildSnapshot(first, NOW).buckets);
  });

  it("resumes a grown file from its offset and rescans a shrunk one from zero", async () => {
    const home = tempHome();
    const file = claudeHome(home, assistantLine("1", 10));
    const first = await scanAll(emptyCache(), home, NOW);

    appendFileSync(file, assistantLine("2", 5));
    pin(file, T0 + 1000);
    const grown = await scanAll(first.cache, home, NOW);
    const grownTotal = buildSnapshot(grown, NOW).buckets.reduce(
      (sum, bucket) => sum + bucket.counters.output,
      0,
    );
    expect(grownTotal).toBe(15);

    // Shrink: a truncated file is a different thing at the same path.
    writeFileSync(file, assistantLine("3", 7));
    pin(file, T0 + 2000);
    const shrunk = await scanAll(grown.cache, home, NOW);
    const shrunkTotal = buildSnapshot(shrunk, NOW).buckets.reduce(
      (sum, bucket) => sum + bucket.counters.output,
      0,
    );
    expect(shrunkTotal).toBe(7);
  });

  it("drops a file that vanishes from the corpus — the data follows the disk", async () => {
    const home = tempHome();
    const file = claudeHome(home, assistantLine("1", 10));
    const first = await scanAll(emptyCache(), home, NOW);
    expect(buildSnapshot(first, NOW).buckets).toHaveLength(1);

    // Replace the file with a dangling symlink: discovery refuses symlinks,
    // so the path leaves the corpus and its record leaves the cache — same
    // as the Rust scanner. (The keep-on-transient-failure path guards a file
    // that is still DISCOVERED but cannot be statted or opened; a permission
    // fixture cannot prove it here because these tests may run as root.)
    rmSync(file);
    const { symlinkSync } = await import("node:fs");
    symlinkSync(path.join(home, "gone"), file);
    const second = await scanAll(first.cache, home, NOW);
    expect(buildSnapshot(second, NOW).buckets).toEqual([]);
  });

  it("drops an archived Codex copy of a still-active session", async () => {
    const home = tempHome();
    const sessions = path.join(home, ".codex", "sessions");
    const archived = path.join(home, ".codex", "archived_sessions");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(archived, { recursive: true });
    const meta = `${JSON.stringify({
      timestamp: "2026-08-10T04:45:59.358Z",
      type: "session_meta",
      payload: { id: "codex-1", session_id: "codex-1" },
    })}\n`;
    const count = `${JSON.stringify({
      timestamp: "2026-08-10T04:46:10.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 10,
          },
        },
      },
    })}\n`;
    const active = path.join(sessions, "rollout-a.jsonl");
    const copy = path.join(archived, "rollout-a-copy.jsonl");
    writeFileSync(active, meta + count);
    writeFileSync(copy, meta + count);
    pin(active);
    pin(copy);
    const outcome = await scanAll(emptyCache(), home, NOW);
    const snapshot = buildSnapshot(outcome, NOW);
    // Counted once, and the copy is not in the file count either.
    expect(snapshot.buckets.reduce((sum, bucket) => sum + bucket.counters.output, 0)).toBe(10);
    expect(snapshot.sources[1]).toMatchObject({
      agent: "codex",
      filesScanned: 1,
    });
  });

  it("accumulates skipped lines across scans instead of resetting them", async () => {
    const home = tempHome();
    const file = claudeHome(home, `not json at all\n${assistantLine("1", 3)}`);
    const first = await scanAll(emptyCache(), home, NOW);
    expect(buildSnapshot(first, NOW).skippedLines).toBe(1);
    appendFileSync(file, "still not json\n");
    pin(file, T0 + 1000);
    const second = await scanAll(first.cache, home, NOW);
    expect(buildSnapshot(second, NOW).skippedLines).toBe(2);
  });
});

describe("compaction", () => {
  it("rolls an aged file's entries into totals and survives a warm poll", async () => {
    const home = tempHome();
    claudeHome(home, assistantLine("1", 10) + assistantLine("2", 20));
    const first = await scanAll(emptyCache(), home, NOW);
    const record = [...first.cache.files.values()][0];
    expect(record.compacted).toBe(false);
    expect(record.entries.size).toBe(2);

    // Two days later, nothing moved: the warm path still compacts.
    const later = NOW + 49 * 60 * 60 * 1000;
    const second = await scanAll(first.cache, home, later);
    const compacted = [...second.cache.files.values()][0];
    expect(compacted.compacted).toBe(true);
    expect(compacted.entries.size).toBe(0);
    expect(
      buildSnapshot(second, later).buckets.reduce((sum, bucket) => sum + bucket.counters.output, 0),
    ).toBe(30);
  });
});

describe("cross-file dedupe", () => {
  it("counts a message shared by two live files once", async () => {
    const home = tempHome();
    const project = path.join(home, ".claude", "projects", "proj");
    mkdirSync(project, { recursive: true });
    const line = assistantLine("dup", 50);
    for (const name of ["a.jsonl", "b.jsonl"]) {
      const file = path.join(project, name);
      writeFileSync(file, line);
      pin(file);
    }
    const outcome = await scanAll(emptyCache(), home, NOW);
    expect(
      buildSnapshot(outcome, NOW).buckets.reduce((sum, bucket) => sum + bucket.counters.output, 0),
    ).toBe(50);
  });
});
