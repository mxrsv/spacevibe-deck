/**
 * The remembered rows of the project rail (launcher spec LCH-2): which project each remembered
 * agent pane sits under, and what its row says. Pure, over the rail's own per-project checkouts,
 * so a remembered pane lands under the project the live rows of the same folder would.
 */
import { worktreeForPath } from "../../repositories/repository-model";
import type { RememberedPane } from "../../lib/session-schema";
import { displayAgent, type RailWorktreeGroup } from "../agent-rail-card-model";
import { fuzzyMatch } from "../rail-view-model";

export interface RememberedRowModel {
  readonly pane: RememberedPane;
  /** The pane's last title, else the agent's display name. */
  readonly title: string;
  /** The checkout's branch from the repository scan; null for a plain folder or an unknown path. */
  readonly branch: string | null;
}

interface Owner {
  readonly projectKey: string;
  /** The checkout whose root this path is; null for a repository root that is no listed checkout. */
  readonly checkout: RailWorktreeGroup | null;
}

/** Every checkout root and repository root of every shown project, by path; a checkout wins. */
function ownersByPath(
  checkouts: ReadonlyMap<string, readonly RailWorktreeGroup[]>,
): ReadonlyMap<string, Owner> {
  const owners = new Map<string, Owner>();
  for (const [projectKey, group] of checkouts) {
    for (const checkout of group) {
      owners.set(checkout.path, { projectKey, checkout });
    }
  }
  for (const [projectKey, group] of checkouts) {
    for (const checkout of group) {
      if (!owners.has(checkout.repositoryPath)) {
        owners.set(checkout.repositoryPath, { projectKey, checkout: null });
      }
    }
  }
  return owners;
}

/**
 * Each remembered pane under its project, newest first (the store's order). A pane whose
 * folder no shown project covers has no row to sit under and is left out; it stays in the store.
 */
export function rememberedRowsByProject(
  panes: readonly RememberedPane[],
  checkouts: ReadonlyMap<string, readonly RailWorktreeGroup[]>,
): ReadonlyMap<string, readonly RememberedRowModel[]> {
  const owners = ownersByPath(checkouts);
  const paths = [...owners.keys()];
  const byProject = new Map<string, RememberedRowModel[]>();
  for (const pane of panes) {
    const root = worktreeForPath(paths, pane.cwd) ?? worktreeForPath(paths, pane.workspacePath);
    const owner = root === null ? undefined : owners.get(root);
    if (owner === undefined) {
      continue;
    }
    const checkout = owner.checkout;
    const row: RememberedRowModel = {
      pane,
      title: pane.title ?? displayAgent(pane.agent),
      branch:
        checkout !== null && checkout.labelled && checkout.branch !== "" ? checkout.branch : null,
    };
    byProject.set(owner.projectKey, [...(byProject.get(owner.projectKey) ?? []), row]);
  }
  return byProject;
}

/** The rail search, as it applies to a live row: title, branch and project. */
export function rememberedRowMatches(
  row: RememberedRowModel,
  project: string,
  query: string,
): boolean {
  return query.trim() === "" || fuzzyMatch(query, `${row.title} ${row.branch ?? ""} ${project}`);
}
