/**
 * Where New File and New Folder put the entry (design §5.1).
 *
 * VS Code's rule: the FOCUSED directory, falling back to the workspace root.
 * "Always the root" was offered and declined — it is unusable once the user is
 * working deep in a tree. The modal states the answer as a line of its own,
 * because the button the user pressed sits on the ROOT's row and may well
 * create somewhere else.
 *
 * Pure, and separate from `tree-focus.ts`: that module answers where focus IS,
 * this one answers what focus MEANS for a create.
 */
import { canExpand, type TreeRow } from "./file-tree";
import { parentDirectory } from "../lib/path-name";

/** The directory a new entry belongs in. Always inside the tree the caller
 * named — an unknown focused path answers the root rather than guessing. */
export function createTargetDirectory(
  rows: readonly TreeRow[],
  focusedPath: string | null,
  root: string,
): string {
  if (focusedPath === null) {
    return root;
  }
  const focused = rows.find((row) => row.path === focusedPath);
  if (focused === undefined) {
    return root;
  }
  // A symlink out of the root renders as a leaf and cannot be walked into
  // (`canExpand`), so it cannot be created into either — creating there would
  // write outside the workspace, which the main-process guard would refuse
  // anyway. Answering the root makes the refusal impossible instead of loud.
  if (focused.directory && canExpand(focused)) {
    return focused.path;
  }
  return parentDirectory(focused.path);
}
