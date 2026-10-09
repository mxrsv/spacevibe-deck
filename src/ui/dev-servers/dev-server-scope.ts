/**
 * Which servers the dev servers popover shows: the folders Deck asks the core to
 * watch, the checkout and repository the rail's active tab belongs to, and
 * whether a row falls inside the chosen scope. Pure.
 *
 * Paths are compared as the renderer spells them (`displayRoot`), never as the
 * core's canonical `workspacePath`, which is realpath'd and so differs from the
 * active tab's path wherever a symlink sits above it (`/var` against
 * `/private/var`).
 */
import type { DevServerRow } from "../../dev-servers/dev-server-types";
import { normalizeWorkspacePath, workspaceLabel } from "../../lib/workspace-label";
import type { RepositoryScan } from "../../repositories/repository-client";
import { worktreeForPath } from "../../repositories/repository-model";

export type DevServerScope = "worktree" | "project" | "all";

export const SCOPE_LABEL: Readonly<Record<DevServerScope, string>> = {
  worktree: "This worktree",
  project: "This project",
  all: "All projects",
};

export const SCOPES: readonly DevServerScope[] = ["worktree", "project", "all"];

/**
 * The folders Deck asks the core to watch: every open tab's workspace plus the
 * retained recents the Open board already bounds (`MAX_RECENTS`). One spelling
 * per folder, sorted so an unchanged set compares equal and a re-published tab
 * list does not re-register anything.
 */
export function devServerRoots(
  tabPaths: readonly (string | null)[],
  recentPaths: readonly string[],
): string[] {
  const roots = new Set<string>();
  for (const path of [...tabPaths, ...recentPaths]) {
    const normalized = path === null ? null : normalizeWorkspacePath(path);
    if (normalized !== null) {
      roots.add(normalized);
    }
  }
  return [...roots].sort();
}

/** The folder, branch and repository the popover's scope follows. */
export interface DevServerSubject {
  readonly path: string | null;
  readonly name: string;
  readonly branch: string | null;
  /** The checkout the active path belongs to; the path itself when unscanned. */
  readonly worktree: string | null;
  readonly scan: Extract<RepositoryScan, { kind: "repository" }> | null;
}

export type ScanMap = ReadonlyMap<string, RepositoryScan>;

function worktreePaths(scan: Extract<RepositoryScan, { kind: "repository" }>): string[] {
  return scan.worktrees.flatMap((entry) => normalizeWorkspacePath(entry.path) ?? []);
}

export function repositoryScan(
  scans: ScanMap,
  path: string,
): Extract<RepositoryScan, { kind: "repository" }> | null {
  const scan = scans.get(path);
  return scan?.kind === "repository" ? scan : null;
}

export function subjectFor(activePath: string | null, scans: ScanMap): DevServerSubject {
  const path = activePath === null ? null : normalizeWorkspacePath(activePath);
  if (path === null) {
    return { path: null, name: "No folder", branch: null, worktree: null, scan: null };
  }
  const scan = repositoryScan(scans, path);
  const worktree = scan === null ? path : (worktreeForPath(worktreePaths(scan), path) ?? path);
  const entry = scan?.worktrees.find((item) => normalizeWorkspacePath(item.path) === worktree);
  return {
    path,
    name: workspaceLabel(scan === null ? path : scan.root),
    branch: entry?.branch ?? null,
    worktree,
    scan,
  };
}

/** The checkout a row's root sits in, relative to the subject's repository. */
function worktreeOfRow(root: string, subject: DevServerSubject): string {
  return subject.scan === null
    ? root
    : (worktreeForPath(worktreePaths(subject.scan), root) ?? root);
}

export function inScope(
  row: DevServerRow,
  scope: DevServerScope,
  subject: DevServerSubject,
  scans: ScanMap,
): boolean {
  if (scope === "all") {
    return true;
  }
  const root = normalizeWorkspacePath(row.displayRoot) ?? row.displayRoot;
  if (scope === "worktree") {
    return subject.worktree !== null && worktreeOfRow(root, subject) === subject.worktree;
  }
  if (subject.scan === null) {
    return subject.worktree !== null && root === subject.worktree;
  }
  return (
    worktreeForPath(worktreePaths(subject.scan), root) !== null ||
    repositoryScan(scans, root)?.key === subject.scan.key
  );
}
