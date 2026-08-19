/**
 * Status-bar derivation for the active file surface.
 *
 * Split out of `file-surface-store.ts`, which stays the SSOT for file-surface
 * state (`activeFileTab`, `fileDocuments`); this module only derives what the
 * status bar reads from that state. The dependency is strictly one-way — this
 * module imports from the store, and the store imports nothing back.
 */
import { activeFileTab, fileDocuments } from "./file-surface-store";

/** What the status bar shows instead of a pane's CWD and pane count. */
export interface FileStatus {
  /** Path relative to the workspace root (spec §7). */
  readonly relativePath: string;
  /** `line:column`, 1-based. */
  readonly position: string;
  readonly encoding: string;
  readonly eol: string;
}

/** Relative form of `path` under `root`, falling back to the absolute path. */
export function relativeToWorkspace(root: string | null, path: string): string {
  if (root === null) {
    return path;
  }
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Status for the active file surface, or null when a terminal tab holds the
 * stage.
 *
 * A function rather than a signal so it stays derived: two sources of truth for
 * "which file is showing" is exactly how a status bar starts lying. Reading it
 * inside a component subscribes to the signals it touches, as usual.
 */
export function currentFileStatus(): FileStatus | null {
  const path = activeFileTab.value;
  if (path === null) {
    return null;
  }
  const document = fileDocuments.value.get(path);
  if (document === undefined) {
    return null;
  }
  return {
    relativePath: relativeToWorkspace(document.workspacePath, path),
    position: `${document.line}:${document.column}`,
    encoding:
      document.file === null
        ? "—"
        : document.file.encoding === "utf-8"
          ? "UTF-8"
          : "UTF-8 (invalid)",
    eol: document.file === null ? "—" : document.file.eol === "crlf" ? "CRLF" : "LF",
  };
}
