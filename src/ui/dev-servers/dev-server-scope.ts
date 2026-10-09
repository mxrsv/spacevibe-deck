/**
 * Which servers the dev servers popover shows: the folders Deck asks the core to
 * watch, the checkout and repository the rail's active tab belongs to, and
 * whether a row falls inside the chosen scope. Pure.
 *
 * Two spellings of one folder meet here. A tab's path is as the user opened it
 * (`/tmp/p/alpha`); git, and so every scanned worktree, reports the realpath
 * (`/private/tmp/p/alpha`), and so does the core's `workspacePath`. `displayRoot` is
 * whichever spelling the core kept when it collapsed the two. A row therefore matches a
 * checkout on its `displayRoot` or on its `workspacePath` (git's namespace), and the
 * subject's checkout is named in git's spelling whenever the scan knows it.
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
  readonly scan: ScanOfRepository | null;
}

export type ScanMap = ReadonlyMap<string, RepositoryScan>;

type ScanOfRepository = Extract<RepositoryScan, { kind: "repository" }>;

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

/**
 * The checkout holding the tab's folder, in git's spelling. When a symlink above the tab
 * makes `path` match no worktree, `scan.root` (the toplevel git resolved for that very
 * folder) names it, so the tab's checkout is never taken for a different one.
 */
function checkoutOf(scan: ScanOfRepository, path: string): string {
  const paths = worktreePaths(scan);
  const found = worktreeForPath(paths, path);
  if (found !== null) {
    return found;
  }
  const root = normalizeWorkspacePath(scan.root);
  return root !== null && paths.includes(root) ? root : path;
}

export function subjectFor(activePath: string | null, scans: ScanMap): DevServerSubject {
  const path = activePath === null ? null : normalizeWorkspacePath(activePath);
  if (path === null) {
    return { path: null, name: "No folder", branch: null, worktree: null, scan: null };
  }
  const scan = repositoryScan(scans, path);
  const worktree = scan === null ? path : checkoutOf(scan, path);
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
function worktreeOfRow(row: DevServerRow, root: string, subject: DevServerSubject): string {
  const checkouts =
    subject.scan !== null
      ? worktreePaths(subject.scan)
      : subject.worktree === null
        ? []
        : [subject.worktree];
  return (
    worktreeForPath(checkouts, normalizeWorkspacePath(row.workspacePath) ?? row.workspacePath) ??
    worktreeForPath(checkouts, root) ??
    root
  );
}

/**
 * The scan that holds a row's folder: the one taken in that folder, else the one whose
 * worktree list names it (by either spelling), since scans are keyed by the tab's spelling.
 */
export function scanOwning(
  row: DevServerRow,
  root: string,
  scans: ScanMap,
): ScanOfRepository | null {
  const direct = repositoryScan(scans, root);
  if (direct !== null) {
    return direct;
  }
  const canonical = normalizeWorkspacePath(row.workspacePath) ?? row.workspacePath;
  for (const scan of scans.values()) {
    if (scan.kind === "repository" && worktreePaths(scan).includes(canonical)) {
      return scan;
    }
  }
  return null;
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
    return subject.worktree !== null && worktreeOfRow(row, root, subject) === subject.worktree;
  }
  if (subject.scan === null) {
    return subject.worktree !== null && worktreeOfRow(row, root, subject) === subject.worktree;
  }
  return (
    scanOwning(row, root, scans)?.key === subject.scan.key ||
    worktreeForPath(worktreePaths(subject.scan), root) !== null
  );
}
