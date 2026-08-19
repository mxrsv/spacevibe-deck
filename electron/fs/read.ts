/**
 * Reading the workspace: `list_dir`, `read_file`, `stat_files` (plan T10, T11).
 *
 * Every path goes through `path-guard`, so the renderer cannot name a file
 * outside the workspace root — the renderer is not the trust boundary, and
 * terminal output reaches it.
 *
 * The size and binary verdicts are applied HERE rather than in the renderer, so
 * a 50 MB file is never pulled across the bridge to be rejected on the far side.
 */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { readFileContent, refuseForSize, type FileRead } from "../../src/files/file-content";
import { hasRejectedRoot } from "../shell-integration";
import {
  assertInsideRoot,
  isInside,
  PathOutsideWorkspaceError,
  resolveInsideRoot,
  resolveRoot,
} from "./path-guard";

/**
 * Upper bound on one `stat_files` batch (plan T9).
 *
 * `statFiles` is the focus/activation reconcile (spec §5): without a cap, a
 * renderer bug asking to reconcile an unbounded list would put an unbounded
 * amount of `fs.stat` work on the main process from a single IPC call.
 */
export const MAX_STAT_PATHS = 512;

export class MalformedStatRequestError extends Error {
  constructor(message: string) {
    super(`stat_files: ${message}`);
    this.name = "MalformedStatRequestError";
  }
}

export class TooManyStatPathsError extends Error {
  constructor(count: number) {
    super(`stat_files: ${count} paths exceeds the ${MAX_STAT_PATHS} limit.`);
    this.name = "TooManyStatPathsError";
  }
}

/** One row of a directory listing, as the renderer's tree model wants it. */
export interface DirEntryPayload {
  readonly name: string;
  readonly path: string;
  readonly directory: boolean;
  readonly outOfRoot: boolean;
}

/**
 * Upper bound on concurrent `fs.realpath` calls while resolving one
 * `listDir` call's symlinks (plan T10).
 *
 * `listDir` is uncapped in entry count (a 10k-entry directory is normal, see
 * below), and every symlinked entry used to resolve through
 * `resolveInsideRoot`'s SYNCHRONOUS `realpathSync`, in the same loop that
 * walks the whole listing. A directory where a long run of entries are
 * symlinks that resolve out of the root or dangling never reached the loop's
 * only `await` at all, so it stalled the event loop for the whole call.
 * Resolving with a bounded async pool instead keeps one `listDir` call from
 * starving other main-process work, without going fully unbounded and
 * starting thousands of `realpath` syscalls at once.
 */
export const MAX_REALPATH_CONCURRENCY = 32;

/**
 * Runs `worker` over `items` with at most `limit` in flight at once. Results
 * are index-aligned with `items` regardless of completion order, so a caller
 * can write them straight into a preallocated array.
 */
async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runOne(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, runOne));
  return results;
}

/**
 * The directory/out-of-root verdict for one symlinked entry, resolved
 * through `fs.realpath` (async) rather than `path-guard`'s synchronous
 * `realpathSync` — this is the per-entry work `mapWithConcurrencyLimit`
 * bounds. Mirrors `resolveInsideRoot`'s authorization rule exactly (compare
 * against the root's OWN canonical form, refuse a rejected root shape before
 * touching the filesystem) but takes the already-canonical root as an
 * argument instead of re-resolving it per entry.
 */
async function resolveSymlinkEntry(
  canonicalRoot: string,
  full: string,
): Promise<{ directory: boolean; outOfRoot: boolean }> {
  if (hasRejectedRoot(full)) {
    return { directory: false, outOfRoot: true };
  }
  let canonical: string;
  try {
    canonical = await fs.realpath(full);
  } catch {
    // Dangling symlink. Renders as a leaf and does not open (spec §3.1).
    return { directory: false, outOfRoot: true };
  }
  if (!isInside(canonicalRoot, canonical)) {
    return { directory: false, outOfRoot: true };
  }
  try {
    const stats = await fs.stat(canonical);
    return { directory: stats.isDirectory(), outOfRoot: false };
  } catch {
    return { directory: false, outOfRoot: false };
  }
}

/**
 * One directory, non-recursive.
 *
 * Deliberately uncapped: a 10k-entry directory is normal in the repos Deck is
 * pointed at (spec §3.1), and truncating one silently would read as "that is
 * all there is". The panel virtualizes instead.
 */
export async function listDir(root: string, directory: string): Promise<DirEntryPayload[]> {
  const canonicalDirectory = assertInsideRoot(root, directory);
  // Resolved once per call, not once per symlinked entry: `directory` above
  // already proved `root` resolves, and the filesystem cannot change between
  // these two synchronous calls.
  const canonicalRoot = resolveRoot(root);
  if (canonicalRoot === null) {
    throw new PathOutsideWorkspaceError(root);
  }
  const entries = await fs.readdir(canonicalDirectory, { withFileTypes: true });
  const rows: DirEntryPayload[] = new Array(entries.length);
  const symlinkIndices: number[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const full = path.join(canonicalDirectory, entry.name);
    if (!entry.isSymbolicLink()) {
      rows[index] = {
        name: entry.name,
        path: full,
        directory: entry.isDirectory(),
        outOfRoot: false,
      };
      continue;
    }
    // A symlink is the one entry whose destination decides what it is.
    // Resolved below, bounded, so the renderer never has to ask a second
    // question about a row it is already drawing.
    symlinkIndices.push(index);
  }
  await mapWithConcurrencyLimit(symlinkIndices, MAX_REALPATH_CONCURRENCY, async (entryIndex) => {
    const entry = entries[entryIndex];
    const full = path.join(canonicalDirectory, entry.name);
    const verdict = await resolveSymlinkEntry(canonicalRoot, full);
    rows[entryIndex] = {
      name: entry.name,
      path: full,
      directory: verdict.directory,
      outOfRoot: verdict.outOfRoot,
    };
  });
  return rows;
}

export interface FileStatPayload {
  readonly path: string;
  readonly exists: boolean;
  readonly mtimeMs: number | null;
  readonly size: number | null;
}

/**
 * Batch `stat`, index-aligned with `paths`.
 *
 * Batch-shaped on purpose and it must stay that way: this is the reconcile
 * fallback for `fs.watch`'s missed events (spec §5), which runs on window focus
 * and on every tab activation. One call per file would put N IPC round-trips on
 * the focus path.
 */
export async function statFiles(
  root: string,
  paths: readonly string[],
): Promise<FileStatPayload[]> {
  if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== "string")) {
    throw new MalformedStatRequestError("paths must be an array of strings.");
  }
  // The cap is on the RAW count, duplicates included: deduping first would
  // let a caller pad past the limit with one path repeated, and it would
  // break the batch's index-alignment contract for anyone who did.
  if (paths.length > MAX_STAT_PATHS) {
    throw new TooManyStatPathsError(paths.length);
  }
  return Promise.all(
    paths.map(async (target): Promise<FileStatPayload> => {
      const resolved = resolveInsideRoot(root, target);
      if (resolved === null) {
        return { path: target, exists: false, mtimeMs: null, size: null };
      }
      try {
        const stats = await fs.stat(resolved);
        return {
          path: target,
          exists: stats.isFile(),
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        };
      } catch {
        return { path: target, exists: false, mtimeMs: null, size: null };
      }
    }),
  );
}

export type ReadFileResult =
  | {
      readonly kind: "ok";
      readonly content: string;
      readonly eol: "lf" | "crlf";
      readonly encoding: "utf-8" | "invalid-utf-8";
      readonly bytes: number;
      readonly mixedEol: boolean;
      readonly readOnly: boolean;
      readonly reason: string | null;
      readonly mtimeMs: number;
      readonly size: number;
      /** Whether the file is writable by this process — a read-only file on
       * disk must not present an editor that cannot save. */
      readonly writable: boolean;
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * One file's content plus the verdicts from `file-content.ts`.
 *
 * The size check runs against `stat` BEFORE the read, which is the ordering the
 * whole module exists for.
 */
export async function readFile(root: string, target: string): Promise<ReadFileResult> {
  const resolved = assertInsideRoot(root, target);
  const stats = await fs.stat(resolved);
  if (!stats.isFile()) {
    return { kind: "refused", reason: "That is not a file." };
  }
  const tooLarge = refuseForSize(stats.size);
  if (tooLarge !== null) {
    return { kind: "refused", reason: tooLarge };
  }
  const bytes = await fs.readFile(resolved);
  const verdict: FileRead = readFileContent(new Uint8Array(bytes));
  if (verdict.kind === "refused") {
    return verdict;
  }
  let writable = true;
  try {
    await fs.access(resolved, constants.W_OK);
  } catch {
    writable = false;
  }
  return {
    kind: "ok",
    content: verdict.file.content,
    eol: verdict.file.eol,
    encoding: verdict.file.encoding,
    bytes: verdict.file.bytes,
    mixedEol: verdict.file.mixedEol,
    readOnly: verdict.file.readOnly || !writable,
    reason:
      verdict.file.reason ??
      (writable ? null : "This file is not writable, so it opens read-only."),
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    writable,
  };
}
