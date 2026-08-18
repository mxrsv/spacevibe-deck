import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCache, writeCache } from './cache';
import { USAGE_CACHE_VERSION, emptyCache, emptyRecord, type UsageCache } from './model';

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-cache-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sampleCache(): UsageCache {
  const cache = emptyCache();
  const record = emptyRecord('claude', 'sess-1', 5, 10);
  record.entries.set('k1', {
    bucketStartMs: 900_000,
    model: 'm',
    counters: {
      inputUncached: 1,
      cacheRead: 2,
      cacheCreate5m: 3,
      cacheCreate1h: 4,
      cacheWrite: 0,
      output: 5,
    },
  });
  record.offset = 42;
  record.skippedLines = 1;
  cache.files.set('/a/file.jsonl', record);
  return cache;
}

describe('usage cache', () => {
  it('round-trips through disk', () => {
    const file = path.join(tempDir(), 'usage-cache.json');
    const cache = sampleCache();
    writeCache(file, cache);
    expect(loadCache(file)).toEqual(cache);
  });

  it('returns an empty cache for a missing path, corrupt JSON or a version mismatch', () => {
    expect(loadCache(null)).toEqual(emptyCache());
    expect(loadCache(path.join(tempDir(), 'absent.json'))).toEqual(emptyCache());

    const corrupt = path.join(tempDir(), 'usage-cache.json');
    writeFileSync(corrupt, '{not json');
    expect(loadCache(corrupt)).toEqual(emptyCache());

    const mismatched = path.join(tempDir(), 'usage-cache.json');
    writeCache(mismatched, sampleCache());
    const raw = JSON.parse(readFileSync(mismatched, 'utf8')) as {
      cacheVersion: number;
    };
    raw.cacheVersion = USAGE_CACHE_VERSION - 1;
    writeFileSync(mismatched, JSON.stringify(raw));
    expect(loadCache(mismatched)).toEqual(emptyCache());
  });

  it('writes through a temp file, so a failed write leaves the previous cache valid', () => {
    const dir = tempDir();
    const file = path.join(dir, 'usage-cache.json');
    writeCache(file, emptyCache());
    const before = readFileSync(file, 'utf8');
    // Squat a directory on the temp path so the staged write fails before
    // the real file is ever touched. (A read-only directory would not do:
    // these tests may run as root, which permission bits do not stop.)
    mkdirSync(`${file}.tmp`);
    try {
      expect(() => writeCache(file, sampleCache())).toThrow('EISDIR');
    } finally {
      rmSync(`${file}.tmp`, { recursive: true, force: true });
    }
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('serializes deterministically regardless of map insertion order', () => {
    const a = emptyCache();
    a.files.set('/b.jsonl', emptyRecord('codex', 's2', 1, 1));
    a.files.set('/a.jsonl', emptyRecord('claude', 's1', 1, 1));
    const b = emptyCache();
    b.files.set('/a.jsonl', emptyRecord('claude', 's1', 1, 1));
    b.files.set('/b.jsonl', emptyRecord('codex', 's2', 1, 1));
    const fileA = path.join(tempDir(), 'a.json');
    const fileB = path.join(tempDir(), 'b.json');
    writeCache(fileA, a);
    writeCache(fileB, b);
    expect(readFileSync(fileA, 'utf8')).toBe(readFileSync(fileB, 'utf8'));
  });
});
