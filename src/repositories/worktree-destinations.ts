/**
 * Where a quick-picked agent will run: one entry per worktree of the
 * repository the active tab is on.
 *
 * A sibling of `repository-model.ts`, not part of it: that module answers
 * "what does the navigation rail look like" and folds in tabs, archives and
 * collapse state. This one answers a much smaller question — which
 * directories can a NEW tab be opened in — so `AgentQuickPicker` does not
 * have to reach through a rail model to find a list of paths.
 *
 * Worktree and branch are one choice here, not two, because git makes them
 * one: a worktree is checked out on exactly one branch, and two worktrees
 * cannot share a branch. Changing the branch of a worktree is `git checkout`,
 * a write to the repository, which is deliberately not something a modal
 * called "quick" offers (owner decision, 2026-08-16).
 */
import { workspaceLabel } from "../lib/workspace-label";
import type { RepositoryScan } from "./repository-client";
import { worktreeForPath } from "./repository-model";

export interface QuickDestination {
  /** Absolute path of the worktree's working directory. */
  readonly path: string;
  /** Folder name of that directory. */
  readonly name: string;
  /** Short branch name, or null when git reports the worktree detached. */
  readonly branch: string | null;
  /** The repository's own checkout — the entry git reports first. */
  readonly primary: boolean;
}

/**
 * The destinations a scan offers, in git's own order (main checkout first).
 *
 * Empty for anything that is not a readable repository, which is also how a
 * host with no `git_repository` channel lands here — the caller renders no
 * destination row at all rather than an empty control.
 */
export function worktreeDestinations(
  scan: RepositoryScan | null | undefined,
): readonly QuickDestination[] {
  if (scan === null || scan === undefined || scan.kind !== "repository") {
    return [];
  }
  // Bare first, then prunable, in that order and not merged: `primary` means
  // "git listed this first", and the rail computes it on the bare-filtered
  // list (`repository-model.ts`). Dropping prunable entries earlier would
  // move the flag onto a different worktree than the rail marks.
  return scan.worktrees
    .filter((entry) => !entry.bare)
    .map((entry, index) => ({
      path: entry.path,
      name: workspaceLabel(entry.path),
      branch: entry.branch,
      primary: index === 0,
      prunable: entry.prunable,
    }))
    .filter((entry) => entry.prunable === null)
    .map(({ prunable: _prunable, ...destination }) => destination);
}

/** `folder · branch`, or the folder alone when git reports no branch. */
export function destinationLabel(destination: QuickDestination): string {
  return destination.branch === null
    ? destination.name
    : `${destination.name} · ${destination.branch}`;
}

/**
 * Which destination the picker opens on.
 *
 * `preferred` is tried in order — the focused pane's live cwd first, then the
 * active tab's workspace — and each is matched by
 * [`worktreeForPath`](./repository-model.ts)'s longest-prefix rule, so a pane
 * sitting in `worktree/packages/web` still resolves to `worktree`. Falling
 * through lands on the first destination, which is the repository's own
 * checkout; an empty list has no answer and returns null.
 */
export function defaultDestinationPath(
  destinations: readonly QuickDestination[],
  ...preferred: readonly (string | null)[]
): string | null {
  const paths = destinations.map((destination) => destination.path);
  for (const candidate of preferred) {
    if (candidate === null || candidate === "") {
      continue;
    }
    const match = worktreeForPath(paths, candidate);
    if (match !== null) {
      return match;
    }
  }
  return paths[0] ?? null;
}
