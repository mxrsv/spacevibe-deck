import { useEffect } from "preact/hooks";
import { changesController, type ChangesController } from "../../files/changes/changes-controller";
import { installTurnEndWatch } from "../../files/changes/turn-end";
import { ensureRepositoriesScanned, repositoryScans } from "../../repositories/repositories-store";

/**
 * The folder whose changes are read: the root, unless the rail's repository scan calls it plain
 * (that scan, not a `git status`, decides whether Changes is offered at all) or there is none.
 */
export function watchedRoot(root: string | null): string | null {
  if (root === null || repositoryScans.value.get(root)?.kind === "plain") {
    return null;
  }
  return root;
}

/** How many files the checkout has changed, or null before the first read of `root`. */
export function changedFileCount(
  root: string | null,
  changes: ChangesController = changesController(),
): number | null {
  const state = changes.state.value;
  const watched = watchedRoot(root);
  const entries = watched !== null && state.root === watched ? state.snapshot?.entries : undefined;
  return entries === undefined || entries.length === 0 ? null : entries.length;
}

/** The repository a folder belongs to, by the scan's own key; null while unscanned. */
function repositoryOf(path: string): string | null {
  const scan = repositoryScans.value.get(path);
  return scan?.kind === "repository" ? scan.key : null;
}

export interface DockChangesWatchProps {
  readonly root: string | null;
  /** Test seam; the window's own controller otherwise. */
  readonly changes?: ChangesController;
}

/**
 * What the Changes view stands on, kept apart from the view so it outlives the sheet: the
 * controller's watch of the root. `AgentDock` mounts it at every window width, so closing the
 * narrow window's sheet does not release it, and it is held whether or not the view is selected,
 * so the handle's count stays true. Renders nothing. The diff column is the legacy dock's: nothing
 * in this dock opens it, so there is no diff to end here.
 */
export function DockChangesWatch({ root, changes: injected }: DockChangesWatchProps) {
  const changes = injected ?? changesController();
  useEffect(() => {
    if (root !== null) {
      ensureRepositoriesScanned([root]);
    }
  }, [root]);
  const watched = watchedRoot(root);
  useEffect(() => {
    changes.setShown(watched);
  }, [changes, watched]);
  useEffect(() => () => changes.setShown(null), [changes]);

  // A turn that ends in another checkout of the root's repository changes files under this
  // root's own checkout too (the window's trigger only knows the tab's folder), so it reads again.
  useEffect(() => {
    if (watched === null) {
      return;
    }
    return installTurnEndWatch((ended) => {
      const repository = repositoryOf(watched);
      if (ended === watched || (repository !== null && repositoryOf(ended) === repository)) {
        changes.trigger("turn-end");
      }
    });
  }, [changes, watched]);
  return null;
}
