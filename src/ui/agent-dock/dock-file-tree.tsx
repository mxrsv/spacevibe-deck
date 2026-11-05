import { RefreshIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useState } from "preact/hooks";
import { changesController, type ChangesController } from "../../files/changes/changes-controller";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { clearExplorerStatus, explorerStatus } from "../../files/file-surface-store";
import { foldersWithChanges } from "../../files/tree-filter";
import { FileTreeView } from "../../files/ui/file-tree-view";
import { TreeMetricsContext, type TreeMetrics } from "../../files/ui/tree-metrics";
import { DOCK_ROW_HEIGHT } from "./dock-row-height";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { Input } from "../controls/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { watchedRoot } from "./dock-changes-watch";

export interface DockFileTreeProps {
  readonly controller: FileSurfaceController;
  /** The folder the tree is rooted at, or null when no agent stands in one. */
  readonly workspacePath: string | null;
  readonly canCreate: boolean;
  /** Test seam; the window's own Changes controller otherwise. */
  readonly changes?: ChangesController;
}

/** The tree's rows are the dock's one row height, as the Changes list's are. */
const DOCK_TREE_METRICS: TreeMetrics = { rowHeight: DOCK_ROW_HEIGHT, inset: 12 };

/**
 * The project tree with the one status line a failed create reports on, as the legacy
 * `ExplorerTab` lists it. It is the Explorer tab's whole body and the pane beside a file, so the
 * root actions (new file, filters, refresh, collapse) are the same in both. A header row above it
 * searches the rows already shown and re-lists the tree; folders holding changes from the dock's
 * Changes snapshot carry a dot.
 */
export function DockFileTree({ controller, workspacePath, canCreate, changes }: DockFileTreeProps) {
  const [query, setQuery] = useState("");
  // A message belongs to the tree it was raised in.
  useEffect(() => () => clearExplorerStatus(), [workspacePath]);
  // So does a search.
  useEffect(() => setQuery(""), [workspacePath]);

  const state = (changes ?? changesController()).state.value;
  const watched = watchedRoot(workspacePath);
  const live = watched !== null && state.root === watched ? state.snapshot?.entries : undefined;
  const markedFolders = useMemo(
    () => (live === undefined ? undefined : foldersWithChanges(live.map((entry) => entry.path))),
    [live],
  );

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
    <div className="dock-tree flex h-full min-h-0 flex-col">
      {/* RCP-7: a search row is a 36 bar holding a 28 field. */}
      <div className="dock-tree__bar flex h-(--control-h-36) shrink-0 items-center gap-(--space-4) px-(--space-in-lg)">
        <Input
          type="search"
          aria-label="Search files"
          placeholder="Search files"
          className="h-(--control-h-28) flex-1 text-xs"
          value={query}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh files"
                className="text-muted-foreground"
                onClick={() => controller.refreshTree(workspacePath)}
              />
            }
          >
            <DeckIcon icon={RefreshIcon} />
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh files</TooltipContent>
        </Tooltip>
      </div>
      {line === null ? null : (
        <p className={`file-tree-shell__status${line.failed ? " is-failure" : ""}`} role="status">
          {line.text}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <TreeMetricsContext.Provider value={DOCK_TREE_METRICS}>
          <FileTreeView
            controller={controller}
            workspacePath={workspacePath}
            canCreate={canCreate}
            filter={query}
            markedFolders={markedFolders}
          />
        </TreeMetricsContext.Provider>
      </div>
    </div>
  );
}
