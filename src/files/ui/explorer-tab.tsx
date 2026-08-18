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
import type { FileSurfaceController } from '../file-surface-controller';
import { FileTreeView } from './file-tree-view';

export interface ExplorerTabProps {
  readonly controller: FileSurfaceController;
  /** Root of the tree, or null when the active tab has no workspace (spec §2.1). */
  readonly workspacePath: string | null;
}

export function ExplorerTab(props: ExplorerTabProps) {
  if (props.workspacePath === null) {
    return (
      <p class="explorer-tab__empty" role="status">
        This tab has no workspace to show.
      </p>
    );
  }
  return <FileTreeView controller={props.controller} workspacePath={props.workspacePath} />;
}
