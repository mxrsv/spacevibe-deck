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
import { sendableRoots } from "../../dev-servers/dev-server-roots";

export type DevServerScope = "worktree" | "project" | "all";

export const SCOPE_LABEL: Readonly<Record<DevServerScope, string>> = {
  worktree: "This worktree",
  project: "This project",
  all: "All projects",
};

export const SCOPES: readonly DevServerScope[] = ["worktree", "project", "all"];

/**
 * The folders Deck asks the core to watch, in priority order: every open tab's
 * workspace, then the worktrees of every scanned repository, then the retained
 * recents the Open board already bounds (`MAX_RECENTS`).
 *
 * The worktrees matter because the core attributes a server to the deepest root
 * holding its cwd: a worktree nested in its parent checkout
 * (`/repo/.claude/worktrees/x`) that nobody opened would otherwise be labelled
 * `/repo` and show under the parent's "This worktree". Only roots the core
 * accepts are returned, capped at its limit by that priority, then sorted: one
 * spelling per folder, so an unchanged set compares equal and a re-published tab
 * list does not re-register anything.
 */
export function devServerRoots(
  tabPaths: readonly (string | null)[],
  recentPaths: readonly string[],
  scans: ScanMap = new Map(),
): string[] {
  const spell = (paths: readonly (string | null)[]): string[] =>
    paths.flatMap((path) => (path === null ? [] : (normalizeWorkspacePath(path) ?? [])));
  const tabs = spell(tabPaths);
  const recents = spell(recentPaths);
  const known = new Set([...tabs, ...recents]);
  const worktrees = [...known].flatMap((path) => {
    const scan = repositoryScan(scans, path);
    return scan === null ? [] : worktreePaths(scan, { skipPrunable: true });
  });
  return sendableRoots([...tabs, ...worktrees, ...recents]).sort();
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

/** A prunable worktree's folder is gone, so watching it only reports "not found". */
function worktreePaths(
  scan: Extract<RepositoryScan, { kind: "repository" }>,
  { skipPrunable = false } = {},
): string[] {
  return scan.worktrees.flatMap((entry) =>
    skipPrunable && entry.prunable !== null ? [] : (normalizeWorkspacePath(entry.path) ?? []),
  );
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
  // The project is the repository's primary checkout, as the rail names it. `scan.root`
  // is only the folder the scan ran in, so a scan taken from a linked worktree would
  // otherwise name the project after that worktree.
  const primary = scan?.worktrees.find((item) => !item.bare);
  return {
    path,
    name: workspaceLabel(scan === null ? path : (primary?.path ?? scan.root)),
    branch: entry?.branch ?? null,
    worktree,
    scan,
  };
}

/**
 * The checkout a row's root sits in. Without a scan the subject's own folder is the
 * only checkout there is, and a root below it (a package) belongs to it.
 */
function worktreeOfRow(root: string, subject: DevServerSubject): string {
  const checkouts =
    subject.scan !== null
      ? worktreePaths(subject.scan)
      : subject.worktree === null
        ? []
        : [subject.worktree];
  return worktreeForPath(checkouts, root) ?? root;
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
    return subject.worktree !== null && worktreeOfRow(root, subject) === subject.worktree;
  }
  return (
    worktreeForPath(worktreePaths(subject.scan), root) !== null ||
    repositoryScan(scans, root)?.key === subject.scan.key
  );
}
