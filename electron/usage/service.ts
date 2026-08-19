/**
 * Scanner orchestration: the single-flight scan, the published snapshot and
 * the cache lifecycle. Port of `src-tauri/src/usage/mod.rs`'s command half.
 *
 * One in-flight promise serializes scans. A caller that arrives mid-scan
 * gets the last published snapshot rather than queueing a second pass over
 * the same corpus — unless nothing has been published yet, in which case it
 * waits on the in-flight scan (on the very first cold scan there is nothing
 * better to return).
 */
import { loadCache, writeCache } from "./cache";
import { buildSnapshot, scanAll } from "./scan";
import { emptyCache, type UsageCache, type UsageSnapshot } from "./model";

/**
 * The answer when the home directory cannot be resolved at all.
 *
 * `unreadable`, never `missing`: nothing was looked at, so "no data yet"
 * would be a claim this code is in no position to make.
 */
export function unreadableSnapshot(scannedAtMs: number): UsageSnapshot {
  return {
    scannedAtMs,
    buckets: [],
    sources: [
      { agent: "claude", state: "unreadable", filesScanned: 0 },
      { agent: "codex", state: "unreadable", filesScanned: 0 },
    ],
    skippedLines: 0,
  };
}

export interface UsageService {
  /**
   * One snapshot, incremental against the in-memory cache. Rejects only when
   * the scan itself threw unexpectedly; every ordinary failure is in-band
   * through `sources[].state` and `skippedLines`.
   */
  snapshot(): Promise<UsageSnapshot>;
}

export interface UsageServiceDeps {
  /** The OS user's home, or null when it cannot be resolved. */
  readonly home: string | null;
  /** Where the cache lives, or null to run cache-less (tests). */
  readonly cachePath: string | null;
  readonly now?: () => number;
  /** Surfaced for logging only; detail never crosses the IPC boundary. */
  readonly reportCacheWriteFailure?: (error: unknown) => void;
}

export function createUsageService(deps: UsageServiceDeps): UsageService {
  const now = deps.now ?? (() => Date.now());
  /** `null` until the first scan has loaded the cache from disk. */
  let cache: UsageCache | null = null;
  let published: UsageSnapshot | null = null;
  let inFlight: Promise<UsageSnapshot> | null = null;

  async function runScan(): Promise<UsageSnapshot> {
    const home = deps.home;
    if (home === null) {
      return unreadableSnapshot(now());
    }
    if (cache === null) {
      cache = loadCache(deps.cachePath);
    }
    const previous = cache ?? emptyCache();
    const outcome = await scanAll(previous, home, now());
    if (outcome.changed && deps.cachePath !== null) {
      try {
        writeCache(deps.cachePath, outcome.cache);
      } catch (error) {
        // A failed write costs the next cold start some time and nothing
        // else; the previous cache file stays valid because the write is
        // temp-file-plus-rename.
        deps.reportCacheWriteFailure?.(error);
      }
    }
    cache = outcome.cache;
    const snapshot = buildSnapshot(outcome, now());
    published = snapshot;
    return snapshot;
  }

  return {
    snapshot() {
      if (inFlight !== null) {
        // Mid-scan: hand back the last published answer if there is one.
        return published !== null ? Promise.resolve(published) : inFlight;
      }
      const scan = runScan().finally(() => {
        inFlight = null;
      });
      inFlight = scan;
      return scan;
    },
  };
}
