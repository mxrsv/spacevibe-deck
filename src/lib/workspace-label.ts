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

/**
 * Display name for a workspace path: the basename of the directory.
 * Pure — no React, no Web API. Path display itself uses `tildify`.
 */
export function workspaceLabel(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") {
    return "Unknown";
  }
  if (trimmed === "/") {
    return "/";
  }
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  if (withoutTrailing === "") {
    return "/";
  }
  const base = withoutTrailing.slice(withoutTrailing.lastIndexOf("/") + 1);
  return base === "" ? "Unknown" : base;
}
