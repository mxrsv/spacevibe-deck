/**
 * The on-disk cache: load with a version guard, write atomically.
 * Port of `src-tauri/src/usage/cache.rs`, with the Map⇄JSON conversion the
 * Rust side got from serde. Versioned independently from the Rust cache —
 * cutover is a clean install, and this loader discards anything it did not
 * write itself.
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  CACHE_TEMP_SUFFIX,
  USAGE_CACHE_VERSION,
  emptyCache,
  type Contribution,
  type FileRecord,
  type UsageCache,
} from "./model";

/** The serialized shape — `entries` as a plain object with sorted keys. */
interface StoredRecord extends Omit<FileRecord, "entries"> {
  entries: Record<string, Contribution>;
}

interface StoredCache {
  cacheVersion: number;
  files: Record<string, StoredRecord>;
}

function sortedKeys<T>(source: Record<string, T>): string[] {
  return Object.keys(source).sort();
}

function toStored(cache: UsageCache): StoredCache {
  const files: Record<string, StoredRecord> = {};
  for (const key of [...cache.files.keys()].sort()) {
    const record = cache.files.get(key)!;
    const entries: Record<string, Contribution> = {};
    for (const entryKey of [...record.entries.keys()].sort()) {
      entries[entryKey] = record.entries.get(entryKey)!;
    }
    files[key] = { ...record, entries };
  }
  return { cacheVersion: cache.cacheVersion, files };
}

function fromStored(stored: StoredCache): UsageCache {
  const files = new Map<string, FileRecord>();
  for (const key of sortedKeys(stored.files)) {
    const record = stored.files[key];
    const entries = new Map<string, Contribution>();
    for (const entryKey of sortedKeys(record.entries ?? {})) {
      entries.set(entryKey, record.entries[entryKey]);
    }
    files.set(key, {
      agent: record.agent,
      identity: record.identity,
      mtimeMs: record.mtimeMs,
      size: record.size,
      offset: record.offset,
      skippedLines: record.skippedLines ?? 0,
      compacted: record.compacted ?? false,
      entries,
      totals: record.totals ?? [],
      lastModel: record.lastModel ?? null,
      cumulative: record.cumulative ?? null,
    });
  }
  return { cacheVersion: stored.cacheVersion, files };
}

/**
 * The cache from disk, or an empty one.
 *
 * Every failure path — no path, unreadable file, unparseable JSON, a version
 * this build does not understand — returns an empty cache, which makes the
 * next scan a full rescan. That is slow exactly once and always correct;
 * half-trusting a cache this build cannot interpret is neither.
 */
export function loadCache(cachePath: string | null): UsageCache {
  if (cachePath === null) {
    return emptyCache();
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(cachePath);
  } catch {
    return emptyCache();
  }
  let stored: StoredCache;
  try {
    stored = JSON.parse(bytes.toString("utf8")) as StoredCache;
  } catch {
    return emptyCache();
  }
  if (
    stored === null ||
    typeof stored !== "object" ||
    stored.cacheVersion !== USAGE_CACHE_VERSION ||
    stored.files === null ||
    typeof stored.files !== "object"
  ) {
    return emptyCache();
  }
  try {
    return fromStored(stored);
  } catch {
    return emptyCache();
  }
}

/**
 * Write the cache atomically: same-directory temp file, then rename.
 *
 * The rename is what makes it atomic — a same-filesystem rename either
 * happens or does not, so a reader never sees a half-written cache. Writing
 * in place would leave unparseable JSON behind on a crash, and the loader
 * would then throw away a cache describing gigabytes of already-scanned
 * transcripts. Throws on failure; the caller decides that a failed write
 * costs the next cold start some time and nothing else.
 */
export function writeCache(cachePath: string, cache: UsageCache): void {
  mkdirSync(path.dirname(cachePath), { recursive: true });
  const bytes = JSON.stringify(toStored(cache));
  const temp = `${cachePath}${CACHE_TEMP_SUFFIX}`;
  writeFileSync(temp, bytes);
  try {
    renameSync(temp, cachePath);
  } catch (error) {
    // Never leave the temp file behind: it would be mistaken for a cache by
    // nothing, but it would grow one stale copy per failed write.
    try {
      rmSync(temp, { force: true });
    } catch {
      /* the rename error is the one worth reporting */
    }
    throw error;
  }
}
