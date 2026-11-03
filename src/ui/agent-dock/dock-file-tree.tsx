import { useEffect } from "preact/hooks";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { clearExplorerStatus, explorerStatus } from "../../files/file-surface-store";
import { FileTreeView } from "../../files/ui/file-tree-view";

export interface DockFileTreeProps {
  readonly controller: FileSurfaceController;
  /** The folder the tree is rooted at, or null when no agent stands in one. */
  readonly workspacePath: string | null;
  readonly canCreate: boolean;
}

/**
 * The project tree with the one status line a failed create reports on, as the legacy
 * `ExplorerTab` lists it. It is the Explorer tab's whole body and the pane beside a file, so the
 * root actions (new file, filters, refresh, collapse) are the same in both.
 */
export function DockFileTree({ controller, workspacePath, canCreate }: DockFileTreeProps) {
  // A message belongs to the tree it was raised in.
  useEffect(() => () => clearExplorerStatus(), [workspacePath]);
  if (workspacePath === null) {
    return (
      <p className="p-3 text-xs text-muted-foreground" role="status">
        No folder to show.
      </p>
    );
  }
  const status = explorerStatus.value;
  const line = status !== null && status.workspacePath === workspacePath ? status : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {line === null ? null : (
        <p className={`file-tree-shell__status${line.failed ? " is-failure" : ""}`} role="status">
          {line.text}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <FileTreeView controller={controller} workspacePath={workspacePath} canCreate={canCreate} />
      </div>
    </div>
  );
}
