import { baseName, parentDirectory } from "../../lib/path-name";

/** One segment of a file's breadcrumb: a folder to reveal, or the file itself (`folder` null). */
export interface Crumb {
  readonly name: string;
  readonly folder: string | null;
}

/** The folders from just below `root` down to `dir` inclusive; empty when `dir` is not below it. */
export function foldersTo(dir: string, root: string): readonly string[] {
  const chain: string[] = [];
  let at = dir;
  while (at !== root && at.startsWith(root) && parentDirectory(at) !== at) {
    chain.unshift(at);
    at = parentDirectory(at);
  }
  return at === root ? chain : [];
}

/**
 * The path of `file` below `root`, one crumb per folder and the file last. A file outside the
 * root has no folder to reveal in the tree, so it gets the file crumb alone.
 */
export function crumbsFor(file: string, root: string): readonly Crumb[] {
  const folders = foldersTo(parentDirectory(file), root).map((folder) => ({
    name: baseName(folder),
    folder,
  }));
  return [...folders, { name: baseName(file), folder: null }];
}
