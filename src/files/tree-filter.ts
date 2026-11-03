import { isWindowsPath } from "../lib/path-name";
import type { TreeRow } from "./file-tree";

/**
 * The rows whose name contains `query` (case-insensitive), with the folders above each so a match
 * keeps its place. The root row stays. A blank query keeps every row. Only rows the tree already
 * shows are searched: a collapsed folder's children are not listed yet.
 */
export function filterRows(rows: readonly TreeRow[], query: string): readonly TreeRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return rows;
  }
  const keep = new Set<number>([0]);
  rows.forEach((row, index) => {
    if (index === 0 || !row.name.toLowerCase().includes(needle)) {
      return;
    }
    keep.add(index);
    let depth = row.depth;
    for (let above = index - 1; above > 0 && depth > 1; above -= 1) {
      if (rows[above].depth < depth) {
        keep.add(above);
        depth = rows[above].depth;
      }
    }
  });
  return rows.filter((_, index) => keep.has(index));
}

/** Every folder, relative to the root and `/`-separated, that holds one of the changed paths. */
export function foldersWithChanges(paths: readonly string[]): ReadonlySet<string> {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end += 1) {
      folders.add(parts.slice(0, end).join("/"));
    }
  }
  return folders;
}

/** A row's path relative to the root, `/`-separated; "" for the root itself. */
export function relativeTo(root: string, path: string): string {
  const rest = path.length > root.length ? path.slice(root.length + 1) : "";
  return isWindowsPath(root) ? rest.replaceAll("\\", "/") : rest;
}
