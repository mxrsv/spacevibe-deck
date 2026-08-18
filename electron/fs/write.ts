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
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyEol, type Eol } from '../../src/files/file-content';
import { assertWritableInsideRoot } from './path-guard';

/** Distinguishes concurrent writes to one file within a process. */
let tempCounter = 0;

/**
 * Write to a sibling temp file and rename over the target.
 *
 * `rename` within a directory is atomic on both APFS and NTFS, so a reader sees
 * either the old file or the new one — never a half-written store, and never a
 * half-written source file an agent is about to read.
 *
 * Two properties of the TEMP file are load-bearing, and the first one is a
 * security boundary:
 *
 *  - **`wx` (`O_CREAT | O_EXCL`), so the open fails if anything is already
 *    there — a symlink included.** The temp name used to be the fixed
 *    `.<name>.tmp`, opened with a plain `writeFile`, which follows symlinks. A
 *    repository can commit `.package.json.tmp -> ~/.zshrc`; the user then only
 *    has to open `package.json` and press ⌘S, and the editor buffer lands on
 *    the link's target with this function's `chmod` applied to it. Reproduced
 *    before the fix: content written outside the workspace, mode changed, and
 *    the workspace file left as a symlink.
 *  - **A unique name**, so two windows saving the same file (spec §2.2 allows
 *    exactly that) do not race for one temp path and fail the second rename
 *    with `ENOENT`.
 *
 * A failed write removes its temp rather than leaving `.foo.ts.a1b2.tmp` in the
 * user's repository for `git status` to find.
 *
 * `mode` preserves the target's permission bits — without it, saving an
 * executable script would silently strip its `+x`. It is applied to the open
 * HANDLE, not to the path, so it cannot land on something else.
 */
export async function writeFileAtomically(
  filePath: string,
  contents: string,
  options: { readonly mode?: number } = {},
): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  tempCounter += 1;
  const temp = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${tempCounter}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(temp, 'wx');
    await handle.writeFile(contents, 'utf8');
    if (options.mode !== undefined) {
      await handle.chmod(options.mode);
    }
    await handle.close();
    handle = null;
    await fs.rename(temp, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
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
    const stats = await fs.stat(resolved);
    // A directory target would make `dirname(resolved)` the workspace's PARENT,
    // so the temp file would be created outside the root before the rename
    // failed. Reachable through a symlink pointing at the root itself, which
    // `isInside` accepts (a root IS inside itself, correctly, for reading).
    if (!stats.isFile()) {
      throw new Error('Deck can only save over a file.');
    }
    mode = stats.mode & 0o777;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Deck can only')) {
      throw error;
    }
    // The file is gone — "Save again" recreates it with the default mode,
    // which is the only honest answer once the original's bits are lost.
    mode = undefined;
  }
  await writeFileAtomically(resolved, applyEol(text, eol), mode === undefined ? {} : { mode });
  const stats = await fs.stat(resolved);
  return { path: resolved, mtimeMs: stats.mtimeMs, size: stats.size };
}
