/**
 * Separator-aware path splitting for the renderer. Paths reaching the renderer
 * are opaque strings from the host and may be spelled with either separator, so
 * both are honoured — `node:path` is not available here (the renderer stays
 * host-free), which is why this exists at all.
 *
 * Deliberately NOT the same function as `workspaceLabel` in
 * `workspace-label.ts`: that one is POSIX-only, trims, folds repeated trailing
 * slashes and answers `"Unknown"` for an empty path, because it names a
 * WORKSPACE for display. These two answer the raw segments of a file path.
 */

/** Last segment of a path, honouring both `/` and `\`. */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Parent directory of a path. A path with no separator, or whose only
 * separator is the leading one, is its own parent. */
export function parentDirectory(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? path : path.slice(0, cut);
}
