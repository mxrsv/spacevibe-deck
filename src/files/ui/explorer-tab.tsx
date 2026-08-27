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

export interface ExplorerTabProps {
  readonly controller: FileSurfaceController;
  /** Root of the tree, or null when the active tab has no workspace (spec §2.1). */
  readonly workspacePath: string | null;
  /** Whether the running host can answer `create_entry` (design §6.4, §10).
   * Passed explicitly — `App` reads it off the host facade. */
  readonly canCreate: boolean;
}

export function ExplorerTab(props: ExplorerTabProps) {
  const { workspacePath } = props;
  // DL-19.5: the panel's ONE place for transient text, directly under the
  // header. It is the only place a failed create is ever reported — the naming
  // modal closes either way (design §5.4), and a second dialog would be
  // exactly what that rule exists to prevent.
  useEffect(() => {
    // A message belongs to the tree it was raised in; moving the tab to
    // another workspace retires it rather than reprinting it there.
    return () => clearExplorerStatus();
  }, [workspacePath]);

  if (workspacePath === null) {
    return (
      <p class="explorer-tab__empty" role="status">
        This tab has no workspace to show.
      </p>
    );
  }
  const status = explorerStatus.value;
  const line = status !== null && status.workspacePath === workspacePath ? status : null;
  return (
    <div class="explorer-tab">
      {line !== null && (
        <p class={`file-tree-shell__status${line.failed ? " is-failure" : ""}`} role="status">
          {line.text}
        </p>
      )}
      <FileTreeView
        controller={props.controller}
        workspacePath={workspacePath}
        canCreate={props.canCreate}
      />
    </div>
  );
}
