import { baseName } from "./path-name";

/**
 * One spelling per workspace, so two tabs cannot claim the same folder just
 * because one path carries a trailing slash. Empty input → null (no workspace).
 */
export function normalizeWorkspacePath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed === "") {
    return null;
  }
  const stripped = trimmed.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

const TRAILING_SEPARATORS = /[\\/]+$/;

// Gated on a backslash on purpose: bare `C:` and `C:/` never contain one, so
// they keep the label they had before Windows paths were understood.
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:\\+$/;

/**
 * Display name for a workspace path: the basename of the directory. Either
 * separator cuts, because Windows paths reach the renderer as `C:\code\deck`
 * while git reports the same folder as `C:/code/deck`.
 * Pure — no React, no Web API. Path display itself uses `tildify`.
 */
export function workspaceLabel(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") {
    return "Unknown";
  }
  // A drive root has no folder name to show, and stripping its separator would
  // leave the bare drive letter, which reads as a relative "current dir on C".
  if (WINDOWS_DRIVE_ROOT.test(trimmed)) {
    return `${trimmed.slice(0, 2)}\\`;
  }
  const withoutTrailing = trimmed.replace(TRAILING_SEPARATORS, "");
  if (withoutTrailing === "") {
    // Nothing but separators: the filesystem root, spelled as the input spelled it.
    return trimmed.charAt(0);
  }
  const base = baseName(withoutTrailing);
  return base === "" ? "Unknown" : base;
}
