/** The Explorer list and its selected document share the dock width; the list hugs the window edge. */
import { useEffect } from "preact/hooks";
import type { FileSurfaceController } from "../file-surface-controller";
import { clearExplorerStatus, explorerStatus, surfaceFor } from "../file-surface-store";
import { FilePanel } from "./file-panel";
import { FileTreeView } from "./file-tree-view";
import { ChangesList } from "./changes-list";
import { ExplorerSwitch } from "./explorer-switch";
import { changesController, type ChangesController } from "../changes/changes-controller";
import { explorerView } from "../changes/explorer-view";
import { failureLine } from "../changes/changes-model";
import { requestDiffFocus } from "../changes/diff-column-focus";
import { diffSelection, type DiffSelectionStore } from "../changes/diff-selection";
import { ensureRepositoriesScanned, repositoryScans } from "../../repositories/repositories-store";

export interface ExplorerTabProps {
  readonly controller: FileSurfaceController;
  readonly onDocumentEmpty?: () => void;
  /** Root of the tree, or null when the active tab has no workspace (spec §2.1). */
  readonly workspacePath: string | null;
  /** Whether the running host can answer `create_entry` (design §6.4, §10).
   * Passed explicitly — `App` reads it off the host facade. */
  readonly canCreate: boolean;
  /** Whether the running host can answer `git_changes`. The Changes view is
   * omitted where it cannot, as `canCreate` omits the create controls
   * (DL-19.7). Absent means unavailable. */
  readonly changesAvailable?: boolean;
  /** Test seam; the window's own controller otherwise. */
  readonly changes?: ChangesController;
  /** Test seam; the window's own selection otherwise. It must read `changes`. */
  readonly diff?: DiffSelectionStore;
}

const NOT_A_REPOSITORY = "Not a git repository";

export function ExplorerTab(props: ExplorerTabProps) {
  const { workspacePath } = props;
  const changesAvailable = props.changesAvailable === true;
  const changes = props.changes ?? (changesAvailable ? changesController() : null);
  const diff = props.diff ?? diffSelection();

  // DL-19.5: the panel's ONE place for transient text, directly under the
  // header. It is the only place a failed create is ever reported — the naming
  // modal closes either way (design §5.4), and a second dialog would be
  // exactly what that rule exists to prevent.
  useEffect(() => {
    // A message belongs to the tree it was raised in; moving the tab to
    // another workspace retires it rather than reprinting it there.
    return () => clearExplorerStatus();
  }, [workspacePath]);

  // The repository scan the rail already runs answers "is this a repository"
  // without a `git status` (plan C6).
  useEffect(() => {
    if (changesAvailable && workspacePath !== null) {
      ensureRepositoriesScanned([workspacePath]);
    }
  }, [changesAvailable, workspacePath]);

  const scan = workspacePath === null ? undefined : repositoryScans.value.get(workspacePath);
  const changesDisabledReason = scan?.kind === "plain" ? NOT_A_REPOSITORY : null;
  const view = changesAvailable && changesDisabledReason === null ? explorerView.value : "files";
  const showChanges = workspacePath !== null && view === "changes";

  // The Changes chip carries the totals in either view, so the checkout is
  // watched while the Explorer shows a repository, not only while the list is
  // up (owner, 2026-10-10, replacing plan C5). Leaving the tab or closing the
  // dock releases the watch and stops every read.
  const watched = changesAvailable && changesDisabledReason === null ? workspacePath : null;
  useEffect(() => {
    changes?.setShown(watched);
  }, [changes, watched]);
  // Unmounting (another dock tab, a closed dock) hides the list for good.
  useEffect(() => () => changes?.setShown(null), [changes]);
  // The diff column lives only while the list that opened it is shown: leaving
  // Changes, re-rooting on another tab's workspace and unmounting all end it,
  // because `setShown(null)` empties the state and nothing would refresh a
  // diff after (plan 2026-10-10-diff-column, D4).
  // Only a tab that offers Changes owns that diff: the stacked dock mounts this tab for its files
  // alone, beside a Changes section whose diff folding Files must not close.
  useEffect(
    () => (changesAvailable ? () => void diff.close() : undefined),
    [diff, changesAvailable, showChanges, workspacePath],
  );

  if (workspacePath === null) {
    return (
      <p class="explorer-tab__empty" role="status">
        This tab has no workspace to show.
      </p>
    );
  }
  const changesState = changes?.state.value ?? null;
  const live = changesState !== null && changesState.root === workspacePath ? changesState : null;
  const open = diff.selection.value;
  const selectedPath = open !== null && open.root === workspacePath ? open.path : null;
  const status = explorerStatus.value;
  const createLine = status !== null && status.workspacePath === workspacePath ? status : null;
  // One message at a time: a transient create failure wins while it is up, then
  // the git message returns (plan C6).
  const gitLine = showChanges && live?.failure ? failureLine(live.failure) : null;
  return (
    <div
      class={`explorer-tab${surfaceFor(workspacePath).activePath !== null ? " explorer-tab--document" : ""}`}
    >
      <FilePanel
        controller={props.controller}
        workspacePath={workspacePath}
        onEmpty={props.onDocumentEmpty}
      />
      <div class="explorer-tab__list">
        {createLine !== null && (
          <p
            class={`file-tree-shell__status${createLine.failed ? " is-failure" : ""}`}
            role="status"
          >
            {createLine.text}
          </p>
        )}
        {createLine === null && gitLine !== null && (
          <p class="file-tree-shell__status is-failure" role="status">
            {gitLine}
          </p>
        )}
        {changesAvailable && (
          <ExplorerSwitch
            view={view}
            changesTotals={
              live?.snapshot && live.snapshot.entries.length > 0 ? live.snapshot.totals : null
            }
            changesDisabledReason={changesDisabledReason}
            onSelect={(next) => {
              explorerView.value = next;
            }}
          />
        )}
        {showChanges && changes !== null && live !== null ? (
          <ChangesList
            state={live}
            selectedPath={selectedPath}
            onRefresh={() => changes.trigger("refresh")}
            onOpen={(entry) => {
              diff.open(workspacePath, entry.path);
              requestDiffFocus();
            }}
          />
        ) : (
          <FileTreeView
            controller={props.controller}
            workspacePath={workspacePath}
            canCreate={props.canCreate}
          />
        )}
      </div>
    </div>
  );
}
