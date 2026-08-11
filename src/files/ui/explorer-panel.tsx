/**
 * The docked column (plan T29, DL §16).
 *
 * A COLUMN of the `.window` grid, never an overlay: the stage's terminals
 * resize around it rather than being covered. In sidebar layout the window ends
 * up navigation-left, stage-centre, explorer-right — which is exactly why this
 * is a grid column and not something layered onto the stage.
 */
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Eye, EyeOff, FolderOpen } from "lucide-preact";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import { workspaceLabel } from "../../lib/workspace-label";
import {
  clampExplorerWidth,
  EXPLORER_WIDTH_MAX,
  EXPLORER_WIDTH_MIN,
} from "../../settings/settings-schema";
import { setScrollTop, setShowHidden, surfaceFor, treeRows } from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";
import type { TreeRow } from "../file-tree";
import { FileTreeView } from "./file-tree-view";

export interface ExplorerPanelProps {
  readonly workspacePath: string | null;
  readonly activePath: string | null;
  readonly width: number;
  readonly controller: FileSurfaceController;
  readonly onResize: (width: number) => void;
  /** Open a workspace — the empty state's one action. */
  readonly onPickFolder: () => void;
}

export function ExplorerPanel(props: ExplorerPanelProps) {
  const { workspacePath, controller } = props;
  const surface = surfaceFor(workspacePath);
  const rows = treeRows(workspacePath);
  const dragging = useSignal(false);

  // The root listing is loaded on first show and whenever the workspace
  // changes. Everything deeper loads when the user expands it.
  useEffect(() => {
    if (workspacePath !== null) {
      void controller.ensureListing(workspacePath, workspacePath);
    }
  }, [workspacePath, controller]);

  // Drag-resize on the panel's INNER edge. Listeners live on `window` for the
  // duration of the drag: a pointer that leaves the 5px handle mid-drag must
  // not silently stop resizing.
  useEffect(() => {
    if (!dragging.value) {
      return;
    }
    const onMove = (event: PointerEvent): void => {
      props.onResize(clampExplorerWidth(window.innerWidth - event.clientX));
    };
    const stop = (): void => {
      dragging.value = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging.value, props.onResize]);

  const activate = (row: TreeRow): void => {
    if (row.directory && !row.outOfRoot) {
      controller.toggleDirectory(workspacePath as string, row.path);
      return;
    }
    if (row.outOfRoot) {
      return; // a link out of the root renders as a leaf and does not open
    }
    void controller.openFile(workspacePath as string, row.path, false);
  };

  return (
    <aside
      class="explorer"
      aria-label="File explorer"
      style={{ width: `${props.width}px` }}
    >
      {/* DL-16.1: the hairline sits on the stage side, and the handle rides it. */}
      <div
        class={`explorer__grip ${dragging.value ? "is-dragging" : ""}`}
        role="separator"
        aria-label="Resize file explorer"
        aria-orientation="vertical"
        aria-valuenow={props.width}
        aria-valuemin={EXPLORER_WIDTH_MIN}
        aria-valuemax={EXPLORER_WIDTH_MAX}
        onPointerDown={(event) => {
          event.preventDefault();
          dragging.value = true;
        }}
      />
      {/* DL-16.6: ONE hairline-separated header row, at most two actions. */}
      <header class="explorer__head">
        <span class="explorer__title">
          {workspacePath === null ? "files" : workspaceLabel(workspacePath)}
        </span>
        {workspacePath !== null && (
          <button
            type="button"
            class="explorer__action"
            aria-label={
              surface.showHidden ? "Hide dot-entries" : "Show dot-entries"
            }
            aria-pressed={surface.showHidden}
            title={surface.showHidden ? "Hide hidden files" : "Show hidden files"}
            onClick={() => setShowHidden(workspacePath, !surface.showHidden)}
          >
            <DeckIcon icon={surface.showHidden ? Eye : EyeOff} size={ROW_ICON} />
          </button>
        )}
      </header>
      {workspacePath === null ? (
        // NEVER a $HOME fallback: a tree rooted at the home directory is not a
        // mistake the user would notice before scrolling it (spec §2.1).
        <div class="explorer__empty">
          <p class="explorer__empty-text">
            This tab has no workspace, so there is no tree to show.
          </p>
          <button
            type="button"
            class="explorer__empty-action"
            onClick={props.onPickFolder}
          >
            <DeckIcon icon={FolderOpen} size={ROW_ICON} />
            <span>Open a folder</span>
          </button>
        </div>
      ) : (
        <FileTreeView
          rows={rows}
          activePath={props.activePath}
          scrollTop={surface.scrollTop}
          onScroll={(scrollTop) => setScrollTop(workspacePath, scrollTop)}
          onActivate={activate}
          onKeep={(row) => {
            if (!row.directory && !row.outOfRoot) {
              void controller.openFile(workspacePath, row.path, true);
            }
          }}
        />
      )}
    </aside>
  );
}
