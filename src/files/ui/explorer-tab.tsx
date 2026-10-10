/**
 * The file tree, as one tab of the docked side panel (DL §19).
 *
 * This was `ExplorerPanel`, the whole docked column, until 2026-08-16. The
 * column, its resize grip and its drag-past-the-floor close moved up into
 * `DockPanel` when the column stopped belonging to one surface; what is left
 * here is what was always the explorer's own: the tree, and the empty state
 * for a tab with no workspace (spec §2.1).
 *
 * The tab is the TREE and nothing else. The document renders on the stage
 * (`.stage__surface`, mounted by `App`), which is what spec §4.2 always asked
 * for — until 2026-08-14 the editor was parked in a `__preview` block at the
 * bottom of this component as the minimum slice that proved the path end to
 * end, and it is not parked here anymore.
 */
import { useEffect } from "preact/hooks";
import type { FileSurfaceController } from "../file-surface-controller";
import { clearExplorerStatus, explorerStatus } from "../file-surface-store";
import { FileTreeView } from "./file-tree-view";
import { ChangesList } from "./changes-list";
import { ExplorerSwitch } from "./explorer-switch";
import { changesController, type ChangesController } from "../changes/changes-controller";
import { explorerView } from "../changes/explorer-view";
import { absolutePath, failureLine } from "../changes/changes-model";
import { ensureRepositoriesScanned, repositoryScans } from "../../repositories/repositories-store";

export interface ExplorerTabProps {
  readonly controller: FileSurfaceController;
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
}

const NOT_A_REPOSITORY = "Not a git repository";

export function ExplorerTab(props: ExplorerTabProps) {
  const { workspacePath } = props;
  const changesAvailable = props.changesAvailable === true;
  const changes = props.changes ?? (changesAvailable ? changesController() : null);

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

  // The list is "shown" only while its view is up: leaving it (or the tab, or
  // the dock) releases the watch and stops every read (plan C5).
  useEffect(() => {
    changes?.setShown(showChanges ? workspacePath : null);
  }, [changes, showChanges, workspacePath]);
  // Unmounting (another dock tab, a closed dock) hides the list for good.
  useEffect(() => () => changes?.setShown(null), [changes]);

  if (workspacePath === null) {
    return (
      <p class="explorer-tab__empty" role="status">
        This tab has no workspace to show.
      </p>
    );
  }
  const changesState = changes?.state.value ?? null;
  const live = changesState !== null && changesState.root === workspacePath ? changesState : null;
  const status = explorerStatus.value;
  const createLine = status !== null && status.workspacePath === workspacePath ? status : null;
  // One message at a time: a transient create failure wins while it is up, then
  // the git message returns (plan C6).
  const gitLine = showChanges && live?.failure ? failureLine(live.failure) : null;
  return (
    <div class="explorer-tab">
      {createLine !== null && (
        <p class={`file-tree-shell__status${createLine.failed ? " is-failure" : ""}`} role="status">
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
          onRefresh={() => changes.trigger("refresh")}
          onOpen={(entry) => {
            void props.controller.openFile(
              workspacePath,
              absolutePath(workspacePath, entry.path),
              false,
            );
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
  );
}
