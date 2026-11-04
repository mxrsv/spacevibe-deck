import { ArrowRight01Icon, FolderTreeIcon, FloppyDiskIcon } from "@hugeicons/core-free-icons";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import {
  documentFor,
  requestTreeFocus,
  surfaceFor,
  toggleViewMode,
  viewModeFor,
  visibleDirectories,
} from "../../files/file-surface-store";
import { isMarkdownPath } from "../../files/markdown-policy";
import { FilePanel } from "../../files/ui/file-panel";
import { ViewModeToggle } from "../../files/ui/view-mode-toggle";
import { Button } from "../controls/button";
import { DeckIcon, GLYPH_INLINE } from "../controls/deck-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { dockTreePane } from "./agent-dock-state";
import { crumbsFor, foldersTo } from "./dock-file-crumbs";
import { StripCell } from "./dock-strip-cell";
import { DockFileTree } from "./dock-file-tree";

/**
 * Below this body width a side pane gives way: the file tree starts hidden (DOCK-6), and the
 * Changes view has no list toggle at all (DOCK-10). The editor and the stack keep the room.
 */
export const TREE_PANE_MIN_BODY = 560;
const TREE_PANE_WIDTH = "w-65";
/** Crumbs shown before the earlier folders fold into one. */
const VISIBLE_CRUMBS = 3;

export interface DockFileBodyProps {
  readonly controller: FileSurfaceController;
  readonly workspacePath: string;
  readonly canCreate: boolean;
}

/** An unmeasured body (first paint, tests) counts as wide: hiding on a guess would flash. */
function roomyAt(width: number | null): boolean {
  return width === null || width >= TREE_PANE_MIN_BODY;
}

/**
 * Whether `ref`'s element has room for a side pane (`TREE_PANE_MIN_BODY`). It holds the answer,
 * not the width, so a drag-resize renders the body only when the answer flips.
 */
export function useRoomyBody(
  ref: { readonly current: HTMLElement | null },
  mounted: boolean,
): boolean {
  const [roomy, setRoomy] = useState(true);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const measured = node.clientWidth;
    setRoomy(roomyAt(measured > 0 ? measured : null));
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setRoomy(roomyAt(entries[entries.length - 1]?.contentRect.width ?? null));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return roomy;
}

/**
 * The active file tab's body (DOCK-6, DOCK-7): a breadcrumb row, then the editor and, when
 * toggled, the project tree beside it. The tree gives way first: under 560px it starts hidden, and
 * the breadcrumb's tree button brings it back.
 */
/** A path segment reads as text and brightens on hover; it has no fill like a strip cell. */
const CRUMB_CELL =
  "h-auto min-w-0 self-center px-1 hover:bg-transparent focus-visible:bg-transparent";

export function DockFileBody({ controller, workspacePath, canCreate }: DockFileBodyProps) {
  const body = useRef<HTMLDivElement>(null);
  const path = surfaceFor(workspacePath).activePath;
  // The element exists only while a file is active, so the measure follows that.
  const roomy = useRoomyBody(body, path !== null);
  if (path === null) {
    return null;
  }
  const treeOpen = dockTreePane.value ?? roomy;
  const crumbs = crumbsFor(path, workspacePath);
  const hidden = crumbs.length > VISIBLE_CRUMBS ? crumbs.length - VISIBLE_CRUMBS : 0;
  const shown = crumbs.slice(hidden);
  const document = documentFor(path);
  const markdown = isMarkdownPath(path);

  /** Show the tree with `folder` open and its row marked for the keyboard. */
  const reveal = (folder: string): void => {
    dockTreePane.value = true;
    const open = new Set(visibleDirectories(workspacePath));
    for (const directory of foldersTo(folder, workspacePath)) {
      if (!open.has(directory)) {
        controller.toggleDirectory(workspacePath, directory);
      }
    }
    requestTreeFocus(folder);
  };

  const treeLabel = treeOpen ? "Hide the file tree" : "Show the file tree";
  return (
    <div ref={body} className="dock-file flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b pr-2.5 pl-3 text-xs">
        <nav
          aria-label="File path"
          className="flex min-w-0 flex-1 items-stretch overflow-hidden font-sans"
        >
          {hidden === 0 ? null : (
            <>
              <StripCell
                mark="fill"
                className={CRUMB_CELL}
                aria-label="Earlier folders"
                onClick={() => reveal(crumbs[hidden - 1].folder ?? workspacePath)}
              >
                …
              </StripCell>
              <DeckIcon
                icon={ArrowRight01Icon}
                size={GLYPH_INLINE}
                class="shrink-0 self-center text-muted-foreground"
              />
            </>
          )}
          {shown.map((crumb) =>
            crumb.folder === null ? (
              <b key={crumb.name} className="min-w-0 truncate px-1 font-medium text-foreground">
                {crumb.name}
              </b>
            ) : (
              <span key={crumb.folder} className="flex shrink-0 items-center gap-1">
                <StripCell
                  mark="fill"
                  className={CRUMB_CELL}
                  onClick={() => reveal(crumb.folder as string)}
                >
                  {crumb.name}
                </StripCell>
                <DeckIcon
                  icon={ArrowRight01Icon}
                  size={GLYPH_INLINE}
                  class="shrink-0 self-center text-muted-foreground"
                />
              </span>
            ),
          )}
        </nav>
        {markdown ? (
          <ViewModeToggle mode={viewModeFor(path)} onToggle={() => toggleViewMode(path)} />
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Save"
                className="text-muted-foreground"
                disabled={!document?.dirty || document.file?.readOnly}
                onClick={() => void controller.savePath(path)}
              />
            }
          >
            <DeckIcon icon={FloppyDiskIcon} />
          </TooltipTrigger>
          <TooltipContent side="bottom">Save</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={treeLabel}
                aria-pressed={treeOpen}
                className={treeOpen ? "bg-muted text-foreground" : "text-muted-foreground"}
                onClick={() => {
                  dockTreePane.value = !treeOpen;
                }}
              />
            }
          >
            <DeckIcon icon={FolderTreeIcon} />
          </TooltipTrigger>
          <TooltipContent side="bottom">{treeLabel}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1">
          <FilePanel controller={controller} workspacePath={workspacePath} chrome="none" />
        </div>
        {treeOpen ? (
          <div className={`${TREE_PANE_WIDTH} shrink-0 border-l`}>
            <DockFileTree
              controller={controller}
              workspacePath={workspacePath}
              canCreate={canCreate}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
