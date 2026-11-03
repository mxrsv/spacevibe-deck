import {
  Cancel01Icon,
  Folder01Icon,
  PlusSignIcon,
  ChartHistogramIcon,
  Clock01Icon,
  FileEditIcon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef } from "preact/hooks";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { documentFor, promoteFileTab, surfaceFor } from "../../files/file-surface-store";
import { cn } from "@/lib/cn";
import { Button } from "../controls/button";
import { DeckIcon, type DeckGlyph } from "../controls/deck-icon";
import { Separator } from "../controls/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import {
  selectDockExplorer,
  selectDockFile,
  setDockView,
  type DockSurface,
  type DockViewId,
} from "./agent-dock-state";
import { DockFileTab } from "./dock-file-tab";
import { closeGuarded } from "./dock-file-tabs-close";

const VIEW_ICON: Readonly<Record<DockViewId, DeckGlyph>> = {
  changes: FileEditIcon,
  usage: ChartHistogramIcon,
  history: Clock01Icon,
};

const VIEW_LABEL: Readonly<Record<DockViewId, string>> = {
  changes: "Changes",
  usage: "Usage",
  history: "History",
};

export interface DockTabStripProps {
  /** The fixed views this host offers, in order. */
  readonly views: readonly DockViewId[];
  readonly view: DockViewId;
  /** What holds the body, already settled against the files that exist. */
  readonly surface: DockSurface;
  /** The folder whose file tabs are listed, or null when there is none. */
  readonly root: string | null;
  readonly controller: FileSurfaceController;
}

/**
 * The dock's one strip (DOCK-1, DOCK-6): the fixed view icons, a divider, then the file tabs in a
 * region of their own that scrolls sideways while the icons and `+` stay put, and the active tab
 * is kept in view. `+` opens the Explorer tab, which exists only while it is the selected surface.
 */
export function DockTabStrip({ views, view, surface, root, controller }: DockTabStripProps) {
  const surfaceState = surfaceFor(root);
  const tabs = surfaceState.tabs;
  const paths = tabs.map((tab) => tab.path);
  const activePath = surface === "file" ? surfaceState.activePath : null;
  const list = useRef<HTMLDivElement>(null);

  // Only this region scrolls, so bring the selected tab in by its own offsets.
  useEffect(() => {
    const container = list.current;
    const tab = container?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (container === null || tab === null || tab === undefined) {
      return;
    }
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < container.scrollLeft) {
      container.scrollLeft = left;
    } else if (right > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = right - container.clientWidth;
    }
  }, [activePath, surface, tabs.length]);

  const leaveExplorer = (): void => {
    if (surfaceState.activePath !== null) {
      selectDockFile();
    } else {
      setDockView(view);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Dock views"
      className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
    >
      {views.map((id) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={VIEW_LABEL[id]}
                aria-pressed={surface === "view" && id === view}
                className={
                  surface === "view" && id === view
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                }
                onClick={() => setDockView(id)}
              />
            }
          >
            <DeckIcon icon={VIEW_ICON[id]} />
          </TooltipTrigger>
          <TooltipContent side="bottom">{VIEW_LABEL[id]}</TooltipContent>
        </Tooltip>
      ))}
      <Separator orientation="vertical" className="mx-1 h-4 self-center" />
      <div
        ref={list}
        role="tablist"
        aria-label="Open files"
        className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        {root === null
          ? null
          : tabs.map((tab) => (
              <DockFileTab
                key={tab.path}
                path={tab.path}
                preview={tab.preview}
                dirty={documentFor(tab.path)?.dirty ?? false}
                active={tab.path === activePath}
                paths={paths}
                onSelect={() => {
                  selectDockFile();
                  controller.activateFile(root, tab.path);
                }}
                onKeep={() => promoteFileTab(root, tab.path)}
                onClose={(targets) => void closeGuarded(controller, root, targets)}
              />
            ))}
        {surface === "explorer" ? (
          <div
            role="tab"
            aria-selected="true"
            aria-label="Explorer"
            className={cn(
              "group/tab flex h-6 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-xs",
              "text-foreground",
            )}
          >
            <DeckIcon icon={Folder01Icon} />
            <span>Explorer</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close Explorer"
              tabIndex={-1}
              onClick={leaveExplorer}
            >
              <DeckIcon icon={Cancel01Icon} />
            </Button>
          </div>
        ) : null}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open a file"
              aria-pressed={surface === "explorer"}
              className="shrink-0 text-muted-foreground"
              onClick={selectDockExplorer}
            />
          }
        >
          <DeckIcon icon={PlusSignIcon} />
        </TooltipTrigger>
        <TooltipContent side="bottom">Open a file</TooltipContent>
      </Tooltip>
    </div>
  );
}
