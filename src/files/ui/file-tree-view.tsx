/**
 * The tree body of the explorer panel (plan Task 2, spec §3.1).
 *
 * First render: a flat, non-virtualized list built straight from `treeRows`
 * — the depth-first walk `file-tree.ts` already computes, filtered and
 * sorted. Virtualization for a 10k-file directory (spec §3.1) is Task 4;
 * this deliberately is not that yet.
 */
import { useEffect } from "preact/hooks";
import { canExpand, type TreeRow } from "../file-tree";
import { treeRows } from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";

export interface FileTreeViewProps {
  readonly controller: FileSurfaceController;
  readonly workspacePath: string;
}

export function FileTreeView(props: FileTreeViewProps) {
  const { controller, workspacePath } = props;
  const rows = treeRows(workspacePath);

  // The root listing is not loaded by anything else — without this the tree
  // stays empty forever the first time a workspace is shown.
  useEffect(() => {
    void controller.ensureListing(workspacePath, workspacePath);
  }, [controller, workspacePath]);

  function handleClick(row: TreeRow): void {
    if (row.directory) {
      // A symlink out of the root renders as a leaf and does not open
      // (spec §3.1) — canExpand is false for it, so this is a no-op.
      if (canExpand(row)) {
        controller.toggleDirectory(workspacePath, row.path);
      }
      return;
    }
    // Single click opens the workspace's preview tab (spec §4.1); a
    // double-click below promotes it to a kept tab.
    void controller.openFile(workspacePath, row.path, false);
  }

  function handleDoubleClick(row: TreeRow): void {
    if (!row.directory) {
      void controller.openFile(workspacePath, row.path, true);
    }
  }

  return (
    <div class="file-tree" role="tree" aria-label="File explorer">
      {rows.map((row) => (
        <div
          key={row.path}
          role="treeitem"
          aria-expanded={row.directory ? row.expanded : undefined}
          tabIndex={0}
          // DL-19: data rows are 22px, one fixed indent token per depth level.
          class="file-tree__row"
          style={{ paddingLeft: `${8 + row.depth * 14}px` }}
          onClick={() => handleClick(row)}
          onDblClick={() => handleDoubleClick(row)}
        >
          {/* DL-19: a data row keeps its content's real casing. */}
          <span class="file-tree__name">{row.name}</span>
        </div>
      ))}
    </div>
  );
}
