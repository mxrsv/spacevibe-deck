/**
 * The Changes list as a folder tree (spec LAY-6): folders carry roll-up counts, and a folder
 * that holds nothing but one folder folds into it (`src/ui`, not `src` then `ui`). Pure over a
 * reply's entries, like `changes-model.ts`, so the view stays a layout.
 */
import type { ChangeEntry } from "../../host/git-changes-host";
import { countsFor } from "./changes-model";

export interface ChangeFolder {
  /** The folder's full root-relative path with `/`; empty for the root. */
  readonly path: string;
  /** What the row says: one segment, or several joined when a chain of single folders folded. */
  readonly label: string;
  readonly folders: readonly ChangeFolder[];
  readonly files: readonly ChangeEntry[];
  /** Changed files at any depth below. */
  readonly fileCount: number;
  /** Lines added and removed at any depth below; binary and uncounted entries add none. */
  readonly added: number;
  readonly removed: number;
}

interface MutableFolder {
  readonly path: string;
  readonly label: string;
  readonly folders: Map<string, MutableFolder>;
  readonly files: ChangeEntry[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function folderOf(path: string, label: string): MutableFolder {
  return { path, label, folders: new Map(), files: [] };
}

function seal(folder: MutableFolder, folded: boolean): ChangeFolder {
  let current = folder;
  let label = folder.label;
  // Only a folder that holds one folder and no file folds into it; the root never folds.
  if (folded) {
    while (current.files.length === 0 && current.folders.size === 1) {
      current = [...current.folders.values()][0];
      label = `${label}/${current.label}`;
    }
  }
  const folders = [...current.folders.values()]
    .map((child) => seal(child, true))
    .sort((a, b) => byText(a.label, b.label));
  const files = [...current.files].sort((a, b) => byText(a.path, b.path));
  let fileCount = files.length;
  let added = 0;
  let removed = 0;
  for (const entry of files) {
    const counts = countsFor(entry);
    if (counts.kind === "counts") {
      added += counts.added;
      removed += counts.removed;
    }
  }
  for (const child of folders) {
    fileCount += child.fileCount;
    added += child.added;
    removed += child.removed;
  }
  return { path: current.path, label, folders, files, fileCount, added, removed };
}

export function buildChangesTree(entries: readonly ChangeEntry[]): ChangeFolder {
  const root = folderOf("", "");
  for (const entry of entries) {
    const segments = entry.path.split("/");
    let folder = root;
    segments.slice(0, -1).forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let child = folder.folders.get(segment);
      if (child === undefined) {
        child = folderOf(path, segment);
        folder.folders.set(segment, child);
      }
      folder = child;
    });
    folder.files.push(entry);
  }
  return seal(root, false);
}

/** One row of the tree as it stands on screen: a folder, or a changed file. */
export type ChangeTreeRow =
  | { readonly kind: "folder"; readonly key: string; readonly folder: ChangeFolder }
  | { readonly kind: "file"; readonly key: string; readonly entry: ChangeEntry };

export const folderKey = (folder: ChangeFolder): string => `folder:${folder.path}`;
export const fileKey = (entry: ChangeEntry): string => `file:${entry.path}`;

/** The rows in reading order, skipping what a closed folder hides: what arrow keys walk. */
export function visibleRows(
  root: ChangeFolder,
  closed: ReadonlySet<string>,
): readonly ChangeTreeRow[] {
  const rows: ChangeTreeRow[] = [];
  const walk = (folder: ChangeFolder): void => {
    for (const child of folder.folders) {
      rows.push({ kind: "folder", key: folderKey(child), folder: child });
      if (!closed.has(child.path)) {
        walk(child);
      }
    }
    for (const entry of folder.files) {
      rows.push({ kind: "file", key: fileKey(entry), entry });
    }
  };
  walk(root);
  return rows;
}
