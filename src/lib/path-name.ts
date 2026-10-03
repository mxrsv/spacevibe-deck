/**
 * Separator-aware path splitting for the renderer. Paths reaching the renderer
 * are opaque strings from the host and may be spelled with either separator, so
 * both are honoured — `node:path` is not available here (the renderer stays
 * host-free), which is why this exists at all.
 *
 * Deliberately NOT the same function as `workspaceLabel` in
 * `workspace-label.ts`: that one trims, folds repeated trailing separators,
 * keeps a drive root whole and answers `"Unknown"` for an empty path, because
 * it names a WORKSPACE for display. These two answer the raw segments of a
 * file path.
 */

// A drive letter (`C:\…`, or git's `C:/…`) or a UNC prefix (`\\server\share`).
const WINDOWS_PATH_SHAPE = /^(?:[A-Za-z]:|\\\\)/;

/**
 * Whether a path is spelled the way Windows spells one. A backslash is a legal
 * filename character on macOS and Linux, so `/Users/me/a\b` is a folder called
 * `a\b`, not two folders: callers that treat `\` as a separator must do so only
 * when this says the path is a Windows one, or they would change what a POSIX
 * path means. The drive form matches `C:` without requiring a backslash after
 * it because git reports Windows paths with `/` and a path may mix both.
 */
export function isWindowsPath(path: string): boolean {
  return WINDOWS_PATH_SHAPE.test(path.trim());
}

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
