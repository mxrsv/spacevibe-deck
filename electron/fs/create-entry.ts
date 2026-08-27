/**
 * `create_entry` — one new file or one new directory inside a workspace root
 * (design §6.1).
 *
 * ONE channel rather than two because authorization, name validation,
 * canonicalization and the EEXIST mapping are identical for both kinds; only
 * the final syscall differs.
 *
 * Neither existing channel could be reused (design §6.2): `writeTextFile`
 * renames over its target and cannot express "fail if it already exists", so
 * New File on it would silently truncate a file the user forgot about; and
 * `createDirectory` is the task launcher's — not bounded to a workspace root,
 * and its `validName` refuses every name starting with `.`, so `.github`
 * could not be created.
 *
 * Main builds the destination from `parent + name` and NEVER accepts a
 * composed path from the renderer.
 */
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { assertInsideRoot, assertWritableInsideRoot } from "./path-guard";
import { checkEntryName } from "../../src/files/entry-name";

export type EntryKind = "file" | "directory";

export interface CreateEntryParams {
  readonly root: string;
  readonly parent: string;
  readonly name: string;
  readonly kind: EntryKind;
}

export interface CreateEntryResult {
  readonly path: string;
}

export async function createEntry({
  root,
  parent,
  name,
  kind,
}: CreateEntryParams): Promise<CreateEntryResult> {
  // The renderer already refused this name and disabled its confirm. Main
  // checks it again because the renderer is not the trust boundary.
  const check = checkEntryName(name);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  if (kind !== "file" && kind !== "directory") {
    throw new Error("Deck can only create a file or a folder.");
  }
  // The parent must EXIST inside the root — `assertInsideRoot`, not the
  // writable variant, because creating into a directory that is not there is
  // a mistake rather than the "save a file an agent just deleted" case
  // `assertWritableInsideRoot` exists for.
  const parentDirectory = assertInsideRoot(root, parent);
  // Re-guarded after the join. A validated leaf on a canonical parent cannot
  // escape, and this is what SAYS so — it also throws for a destination that
  // already exists as a link pointing out of the root, before any syscall.
  const destination = assertWritableInsideRoot(root, path.join(parentDirectory, name));
  try {
    if (kind === "directory") {
      // `recursive: false` — one directory, and EEXIST rather than a silent
      // success for a name that is already taken.
      await mkdir(destination, { recursive: false });
    } else {
      // `wx` is `O_CREAT | O_EXCL`: it fails if ANYTHING is already there, a
      // symlink included, which is the same reasoning `writeFileAtomically`'s
      // temp file carries.
      const handle = await open(destination, "wx");
      await handle.close();
    }
  } catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      // One message for both kinds (design §6.1).
      throw new Error("An entry with that name already exists.", { cause });
    }
    throw new Error(
      kind === "directory" ? "Couldn't create the folder." : "Couldn't create the file.",
      { cause },
    );
  }
  return { path: destination };
}
