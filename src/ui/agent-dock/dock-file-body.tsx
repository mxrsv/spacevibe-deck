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

/** Below this body width the tree pane starts hidden (DOCK-6); the editor keeps the room. */
export const TREE_PANE_MIN_BODY = 560;
/** The tree pane's width in a body that affords it (the mock's 260px). */
const TREE_PANE_WIDTH = 260;
/** At most this share of the body goes to the tree pane, so the editor keeps the rest (DOCK-11). */
const TREE_PANE_SHARE = 0.4;
/** Folders spelled out before the file; the earlier ones fold into one `…`. */
const VISIBLE_FOLDERS = 2;
/** Below this body width (the 320px sheet) only the file's own folder is spelled out. */
const NARROW_CRUMBS_BELOW = 400;

/**
 * The tree pane gives way first (DOCK-11): 260px where the body affords it, else 40% of the body,
 * so a 320px sheet keeps 192px of editor. An unmeasured body counts as wide, as for the default.
 */
function treePaneWidth(bodyWidth: number | null): number {
  return bodyWidth === null
    ? TREE_PANE_WIDTH
    : Math.min(TREE_PANE_WIDTH, Math.round(bodyWidth * TREE_PANE_SHARE));
}

/** How many folders the breadcrumb spells out before the `…`. */
function visibleCrumbFolders(bodyWidth: number | null): number {
  return bodyWidth !== null && bodyWidth < NARROW_CRUMBS_BELOW ? 1 : VISIBLE_FOLDERS;
}

export interface DockFileBodyProps {
  readonly controller: FileSurfaceController;
  readonly workspacePath: string;
  readonly canCreate: boolean;
}

/** The width of `ref`'s element, or null before the first measure (and where nothing measures). */
function useWidth(ref: { readonly current: HTMLElement | null }, mounted: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const measured = node.clientWidth;
    setWidth(measured > 0 ? measured : null);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[entries.length - 1]?.contentRect.width ?? null);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
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
  const width = useWidth(body, path !== null);
  if (path === null) {
    return null;
  }
  // An unmeasured body (first paint, tests) counts as wide: hiding on a guess would flash.
  const treeOpen = dockTreePane.value ?? (width === null || width >= TREE_PANE_MIN_BODY);
  const crumbs = crumbsFor(path, workspacePath);
  // The file's own crumb is always shown; `visible` counts the folders before it.
  const visible = visibleCrumbFolders(width) + 1;
  const hidden = crumbs.length > visible ? crumbs.length - visible : 0;
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
          <section
            aria-label="Project files"
            className="shrink-0 border-l"
            style={{ width: `${treePaneWidth(width)}px` }}
          >
            <DockFileTree
              controller={controller}
              workspacePath={workspacePath}
              canCreate={canCreate}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
