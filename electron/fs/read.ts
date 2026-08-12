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
import {
  readFileContent,
  refuseForSize,
  type FileRead,
} from "../../src/files/file-content";
import { assertInsideRoot, resolveInsideRoot } from "./path-guard";

/** One row of a directory listing, as the renderer's tree model wants it. */
export interface DirEntryPayload {
  readonly name: string;
  readonly path: string;
  readonly directory: boolean;
  readonly outOfRoot: boolean;
}

/**
 * One directory, non-recursive.
 *
 * Deliberately uncapped: a 10k-entry directory is normal in the repos Deck is
 * pointed at (spec §3.1), and truncating one silently would read as "that is
 * all there is". The panel virtualizes instead.
 */
export async function listDir(
  root: string,
  directory: string,
): Promise<DirEntryPayload[]> {
  const canonicalDirectory = assertInsideRoot(root, directory);
  const entries = await fs.readdir(canonicalDirectory, { withFileTypes: true });
  const rows: DirEntryPayload[] = [];
  for (const entry of entries) {
    const full = path.join(canonicalDirectory, entry.name);
    if (!entry.isSymbolicLink()) {
      rows.push({
        name: entry.name,
        path: full,
        directory: entry.isDirectory(),
        outOfRoot: false,
      });
      continue;
    }
    // A symlink is the one entry whose destination decides what it is. Resolve
    // it once, here, so the renderer never has to ask a second question about
    // a row it is already drawing.
    const resolved = resolveInsideRoot(root, full);
    if (resolved === null) {
      // Out of the root, or dangling. Either way it renders as a leaf and does
      // not open (spec §3.1) — and its type is not worth another stat.
      rows.push({ name: entry.name, path: full, directory: false, outOfRoot: true });
      continue;
    }
    let directoryTarget = false;
    try {
      directoryTarget = (await fs.stat(resolved)).isDirectory();
    } catch {
      directoryTarget = false;
    }
    rows.push({
      name: entry.name,
      path: full,
      directory: directoryTarget,
      outOfRoot: false,
    });
  }
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
export async function readFile(
  root: string,
  target: string,
): Promise<ReadFileResult> {
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
