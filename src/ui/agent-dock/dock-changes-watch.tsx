import { useEffect } from "preact/hooks";
import { changesController, type ChangesController } from "../../files/changes/changes-controller";
import { diffSelection, type DiffSelectionStore } from "../../files/changes/diff-selection";
import { installTurnEndWatch } from "../../files/changes/turn-end";
import { ensureRepositoriesScanned, repositoryScans } from "../../repositories/repositories-store";
import { dockSectionsOpen } from "./agent-dock-state";

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
  /** Test seams; the window's own controller and selection otherwise. */
  readonly changes?: ChangesController;
  readonly diff?: DiffSelectionStore;
}

/**
 * What the Changes section stands on, kept apart from the section so it outlives the sheet: the
 * controller's watch of the root, and the open diff. `AgentDock` mounts it at every window width,
 * so the narrow window's sheet closing releases neither (the diff column sits beside the handle,
 * not in the sheet). Renders nothing.
 *
 * The watch is held whether or not the section is unfolded, so the count stays true. The diff
 * ends when the section is folded, the root moves, or the dock goes, as leaving the legacy
 * Changes view does: the controller empties its state once nothing is shown, and nothing would
 * refresh a diff after.
 */
export function DockChangesWatch({
  root,
  changes: injected,
  diff: injectedDiff,
}: DockChangesWatchProps) {
  const changes = injected ?? changesController();
  const diff = injectedDiff ?? diffSelection();
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

  const open = dockSectionsOpen.value.changes;
  useEffect(() => {
    if (!open) {
      void diff.close();
    }
  }, [open, diff]);
  useEffect(() => () => void diff.close(), [diff, root]);

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
