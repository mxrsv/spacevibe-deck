/**
 * The incremental pass over the corpus, the reconciliation rules and the
 * aggregation into the payload's bucket list.
 * Port of `src-tauri/src/usage/scan.rs`.
 */
import { statSync, type Stats } from "node:fs";
import { ingest } from "./codex";
import {
  discoverClaude,
  discoverCodex,
  fileIdentity,
} from "./discover";
import { readLines } from "./reader";
import {
  COMPACT_AFTER_MS,
  USAGE_CACHE_VERSION,
  addCounters,
  addTotal,
  emptyRecord,
  sortTotals,
  type Contribution,
  type FileRecord,
  type UsageAgent,
  type UsageBucket,
  type UsageCache,
  type UsageCounters,
  type UsageSnapshot,
  type UsageSource,
  type UsageSourceState,
} from "./model";

/** What one file contributed to this pass. */
type FileScan =
  | { readonly kind: "updated"; readonly record: FileRecord }
  /**
   * The file could not be statted or opened. The caller keeps the previous
   * record: a transient permission error must not delete a scan's worth of
   * contributions.
   */
  | { readonly kind: "failed" };

/**
 * A file's modification time in Unix ms. An unreadable or pre-epoch mtime
 * reads as 0, which makes the file look permanently stale — it is compacted
 * and never resumed, which is the safe direction.
 */
export function mtimeMsOf(stats: Stats): number {
  const value = Math.floor(stats.mtimeMs);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Roll a stale file's per-message map into its totals. Age, not scan count:
 * with a 5 s poll a session paused for two minutes would compact and then
 * force a full re-read the moment the user typed again. Correctness survives
 * because a compacted file that changes is rescanned from zero, and
 * reappearing dedupe keys only matter in files that grow.
 */
function compacted(record: FileRecord, nowMs: number): FileRecord {
  if (record.compacted || nowMs - record.mtimeMs <= COMPACT_AFTER_MS) {
    return record;
  }
  const entries = record.entries;
  record.entries = new Map();
  for (const contribution of entries.values()) {
    addTotal(
      record.totals,
      contribution.bucketStartMs,
      contribution.model,
      contribution.counters,
    );
  }
  sortTotals(record.totals);
  record.cumulative = null;
  record.compacted = true;
  return record;
}

/** Deep-copy a record so the cached original stays intact for comparison. */
function cloneRecord(record: FileRecord): FileRecord {
  return {
    ...record,
    entries: new Map(
      [...record.entries].map(([key, value]) => [
        key,
        { ...value, counters: { ...value.counters } },
      ]),
    ),
    totals: record.totals.map((entry) => ({
      ...entry,
      counters: { ...entry.counters },
    })),
    cumulative: record.cumulative === null ? null : { ...record.cumulative },
  };
}

/** One transcript file, resumed or rescanned as the scan rules require. */
function scanFile(
  agent: UsageAgent,
  filePath: string,
  previous: FileRecord | undefined,
  nowMs: number,
): FileScan {
  let meta: Stats | undefined;
  try {
    meta = statSync(filePath, { throwIfNoEntry: false });
  } catch {
    return { kind: "failed" };
  }
  if (meta === undefined || !meta.isFile()) {
    return { kind: "failed" };
  }
  const size = meta.size;
  const mtime = mtimeMsOf(meta);

  // Warm path. Nothing about the file moved, so nothing is opened — this is
  // what keeps a poll over gigabytes of transcripts to one stat per file.
  // The compaction check still runs: a file scanned fresh today only crosses
  // the 48 h line on a later poll where nothing moved.
  if (previous !== undefined && previous.mtimeMs === mtime && previous.size === size) {
    return { kind: "updated", record: compacted(cloneRecord(previous), nowMs) };
  }

  const identity = fileIdentity(filePath);
  if (identity === null) {
    return { kind: "failed" };
  }
  // Resume only when the same session is still there, the file has not
  // shrunk, and there is still a contribution map to resume into.
  const resumable =
    previous !== undefined &&
    previous.identity === identity &&
    previous.size <= size &&
    !previous.compacted
      ? previous
      : undefined;
  const record =
    resumable !== undefined
      ? { ...cloneRecord(resumable), mtimeMs: mtime, size }
      : emptyRecord(agent, identity, mtime, size);

  try {
    readLines(filePath, record.offset, (event) => {
      if (event.kind === "line") {
        if (ingest(agent, event.bytes, record) === "skipped") {
          record.skippedLines += 1;
        }
        record.offset = event.offset;
      } else if (event.kind === "oversized") {
        record.skippedLines += 1;
        record.offset = event.offset;
      }
    });
  } catch {
    return { kind: "failed" };
  }
  sortTotals(record.totals);
  return { kind: "updated", record: compacted(record, nowMs) };
}

export interface ScanOutcome {
  cache: UsageCache;
  /**
   * Whether anything about the contributions moved. The cache file is
   * rewritten only when this is true — an unchanged poll does no
   * serialization at all.
   */
  changed: boolean;
  claude: UsageSourceState;
  codex: UsageSourceState;
}

/**
 * Scan every path for one agent into `files`, returning how many were
 * accounted for. "Accounted for" means the stat succeeded, not that bytes
 * were read: the warm path opens nothing, and counting content-opens would
 * make every healthy warm poll look unreadable.
 *
 * Async, yielding between bounded batches, so a cold pass over gigabytes
 * never starves PTY and window IPC on the main process.
 */
const SCAN_BATCH_FILES = 8;

async function scanInto(
  agent: UsageAgent,
  paths: readonly string[],
  previous: UsageCache,
  nowMs: number,
  files: Map<string, FileRecord>,
): Promise<number> {
  let accounted = 0;
  for (let index = 0; index < paths.length; index += 1) {
    if (index % SCAN_BATCH_FILES === 0 && index > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const key = paths[index];
    const priorCandidate = previous.files.get(key);
    const prior =
      priorCandidate !== undefined && priorCandidate.agent === agent
        ? priorCandidate
        : undefined;
    const outcome = scanFile(agent, key, prior, nowMs);
    if (outcome.kind === "updated") {
      files.set(key, outcome.record);
      accounted += 1;
    } else if (prior !== undefined) {
      files.set(key, cloneRecord(prior));
    }
  }
  return accounted;
}

/**
 * Carry every record for one agent across unchanged. Used when a root exists
 * but cannot be listed: the data is still on disk, this scan simply could
 * not look at it.
 */
function carryOver(
  previous: UsageCache,
  agent: UsageAgent,
  files: Map<string, FileRecord>,
): void {
  for (const [key, record] of previous.files) {
    if (record.agent === agent) {
      files.set(key, cloneRecord(record));
    }
  }
}

/**
 * `ok` unless every candidate failed, which means the root is listable but
 * nothing inside it is.
 */
function sourceState(accounted: number, candidates: number): UsageSourceState {
  return accounted === 0 && candidates > 0 ? "unreadable" : "ok";
}

function recordsEqual(left: FileRecord, right: FileRecord): boolean {
  return (
    JSON.stringify({ ...left, entries: [...left.entries] }) ===
    JSON.stringify({ ...right, entries: [...right.entries] })
  );
}

function filesEqual(
  left: Map<string, FileRecord>,
  right: Map<string, FileRecord>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, record] of left) {
    const other = right.get(key);
    if (other === undefined || !recordsEqual(record, other)) {
      return false;
    }
  }
  return true;
}

/**
 * A file's identity, reusing the cached one when the file has not moved.
 * Saves re-reading the head of every archived rollout on every poll.
 */
function cachedIdentity(filePath: string, previous: UsageCache): string | null {
  const record = previous.files.get(filePath);
  if (record !== undefined) {
    try {
      const meta = statSync(filePath, { throwIfNoEntry: false });
      if (
        meta !== undefined &&
        record.size === meta.size &&
        record.mtimeMs === mtimeMsOf(meta)
      ) {
        return record.identity;
      }
    } catch {
      /* fall through to a fresh read */
    }
  }
  return fileIdentity(filePath);
}

/** A whole incremental scan. `home` is injected, so no test reads a real one. */
export async function scanAll(
  previous: UsageCache,
  home: string,
  nowMs: number,
): Promise<ScanOutcome> {
  const files = new Map<string, FileRecord>();

  const claudeFound = discoverClaude(home);
  let claude: UsageSourceState;
  switch (claudeFound.state) {
    // The root is gone: so is the data it described.
    case "missing":
      claude = "missing";
      break;
    case "unreadable":
      carryOver(previous, "claude", files);
      claude = "unreadable";
      break;
    case "present": {
      const accounted = await scanInto(
        "claude",
        claudeFound.files,
        previous,
        nowMs,
        files,
      );
      claude = sourceState(accounted, claudeFound.files.length);
      break;
    }
  }

  const codexFound = discoverCodex(home);
  let codex: UsageSourceState;
  switch (codexFound.state) {
    case "missing":
      codex = "missing";
      break;
    case "unreadable":
      carryOver(previous, "codex", files);
      codex = "unreadable";
      break;
    case "present": {
      let accounted = await scanInto(
        "codex",
        codexFound.active,
        previous,
        nowMs,
        files,
      );
      // An archived copy of a session that is still active would be counted
      // twice, so it is dropped rather than scanned.
      const activeIds = new Set<string>();
      for (const activePath of codexFound.active) {
        const record = files.get(activePath);
        if (record !== undefined) {
          activeIds.add(record.identity);
        }
      }
      const archived = codexFound.archived.filter((archivedPath) => {
        const identity = cachedIdentity(archivedPath, previous);
        return identity === null || !activeIds.has(identity);
      });
      accounted += await scanInto("codex", archived, previous, nowMs, files);
      codex = sourceState(
        accounted,
        codexFound.active.length + archived.length,
      );
      break;
    }
  }

  // A fresh map, never an accumulation into the cached one: the whole point
  // of comparing against `previous` is that the previous value is still
  // intact to compare with. The map is rebuilt path-sorted so serialization
  // and the cross-file merge are deterministic.
  const sorted = new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const changed = !filesEqual(sorted, previous.files);
  return {
    cache: { cacheVersion: USAGE_CACHE_VERSION, files: sorted },
    changed,
    claude,
    codex,
  };
}

/**
 * Every file's contributions merged into one sorted bucket list.
 *
 * Two passes on purpose. Claude's live per-message entries are collapsed
 * globally first, so the same message appearing in a resumed or forked
 * session's second file is counted once; the fold into buckets happens
 * afterwards. `files` is path-sorted, so "last write wins" is decided by
 * path order and the result is deterministic.
 *
 * Documented limit: a **compacted** file no longer has per-message entries,
 * so a duplicate shared with a compacted file cannot be collapsed — and a
 * compacted file is by definition one that has not grown.
 */
export function aggregateBuckets(cache: UsageCache): UsageBucket[] {
  const claudeEntries = new Map<string, Contribution>();
  const totals = new Map<string, UsageCounters>();
  const keyOf = (bucketStartMs: number, agent: UsageAgent, model: string) =>
    `${String(bucketStartMs).padStart(16, "0")} ${agent === "claude" ? 0 : 1} ${model}`;
  for (const record of cache.files.values()) {
    for (const [key, contribution] of record.entries) {
      claudeEntries.set(key, contribution);
    }
    for (const contribution of record.totals) {
      const slot = keyOf(contribution.bucketStartMs, record.agent, contribution.model);
      const existing = totals.get(slot);
      totals.set(
        slot,
        existing === undefined
          ? { ...contribution.counters }
          : addCounters(existing, contribution.counters),
      );
    }
  }
  for (const contribution of claudeEntries.values()) {
    const slot = keyOf(contribution.bucketStartMs, "claude", contribution.model);
    const existing = totals.get(slot);
    totals.set(
      slot,
      existing === undefined
        ? { ...contribution.counters }
        : addCounters(existing, contribution.counters),
    );
  }
  const keys = [...totals.keys()].sort();
  return keys.map((slot) => {
    const [paddedBucket, agentIndex, ...modelParts] = slot.split(" ");
    return {
      bucketStartMs: Number.parseInt(paddedBucket, 10),
      agent: agentIndex === "0" ? "claude" : "codex",
      model: modelParts.join(" "),
      counters: totals.get(slot)!,
    };
  });
}

function countFiles(cache: UsageCache, agent: UsageAgent): number {
  let count = 0;
  for (const record of cache.files.values()) {
    if (record.agent === agent) {
      count += 1;
    }
  }
  return count;
}

export function buildSnapshot(
  outcome: ScanOutcome,
  scannedAtMs: number,
): UsageSnapshot {
  const sources: UsageSource[] = [
    {
      agent: "claude",
      state: outcome.claude,
      filesScanned: countFiles(outcome.cache, "claude"),
    },
    {
      agent: "codex",
      state: outcome.codex,
      filesScanned: countFiles(outcome.cache, "codex"),
    },
  ];
  let skippedLines = 0;
  // Cumulative across the cache, not per scan: a poll that read nothing must
  // not blank out the "n lines skipped" note the UI is showing.
  for (const record of outcome.cache.files.values()) {
    skippedLines += record.skippedLines;
  }
  return {
    scannedAtMs,
    buckets: aggregateBuckets(outcome.cache),
    sources,
    skippedLines,
  };
}
