/**
 * Atomic writes — the ONE implementation (plan T12).
 *
 * `writeAtomically` was a private method inside `JsonStore` (`electron/store.ts`)
 * with 205 lines of tests over it. The spec says saving a file "reuses the
 * atomic write already implemented for the store", and reuse means EXTRACTING
 * it and having the store call the extraction. Copy-pasting it would give the
 * explorer a second implementation that drifts, which is exactly what the two
 * would then disagree about at the worst moment.
 *
 * Saving a file adds the one thing the store never needed: **symlinks are
 * resolved before writing**, so a save replaces the target and not the link.
 * That is carried by `assertWritableInsideRoot`, which realpaths on the way in.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { applyEol, type Eol } from "../../src/files/file-content";
import { assertWritableInsideRoot } from "./path-guard";

/**
 * Write to a sibling temp file and rename over the target.
 *
 * `rename` within a directory is atomic on both APFS and NTFS, so a reader sees
 * either the old file or the new one — never a half-written store, and never a
 * half-written source file an agent is about to read.
 *
 * `mode` preserves the target's permission bits. Without it, saving an
 * executable script through Deck would silently strip its `+x`, because the
 * temp file is created with the default mode.
 */
export async function writeFileAtomically(
  filePath: string,
  contents: string,
  options: { readonly mode?: number } = {},
): Promise<void> {
  const directory = path.dirname(filePath);
  const temp = path.join(directory, `.${path.basename(filePath)}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temp, contents, "utf8");
  if (options.mode !== undefined) {
    await fs.chmod(temp, options.mode);
  }
  await fs.rename(temp, filePath);
}

export interface WriteFileResult {
  /** Canonical path actually written — the symlink TARGET, not the link. */
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/**
 * Save one file inside the workspace root.
 *
 * The path may name a file that does not exist: the spec's dirty+deleted row
 * offers "Save again", and at that moment the file is gone. Only its parent has
 * to be inside the root.
 */
export async function writeTextFile(
  root: string,
  target: string,
  text: string,
  eol: Eol,
): Promise<WriteFileResult> {
  const resolved = assertWritableInsideRoot(root, target);
  let mode: number | undefined;
  try {
    mode = (await fs.stat(resolved)).mode & 0o777;
  } catch {
    // The file is gone — "Save again" recreates it with the default mode,
    // which is the only honest answer once the original's bits are lost.
    mode = undefined;
  }
  await writeFileAtomically(
    resolved,
    applyEol(text, eol),
    mode === undefined ? {} : { mode },
  );
  const stats = await fs.stat(resolved);
  return { path: resolved, mtimeMs: stats.mtimeMs, size: stats.size };
}
