import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  PlusSignIcon,
  ChartHistogramIcon,
  Clock01Icon,
  FileEditIcon,
  Maximize01Icon,
  Minimize01Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { documentFor, promoteFileTab, surfaceFor } from "../../files/file-surface-store";
import { cn } from "@/lib/cn";
import { Button } from "../controls/button";
import { DeckIcon, type DeckGlyph } from "../controls/deck-icon";
import { Separator } from "../controls/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import {
  dockMaximized,
  dockNarrow,
  dockWideAffordable,
  toggleDockMaximized,
} from "./agent-dock-layout";
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

/** What one arrow press moves when no tab is there to measure. */
const FALLBACK_SCROLL_STEP = 120;

/** Whether the file tabs run past their region, and which way they can still move. */
interface TabOverflow {
  readonly overflowing: boolean;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

const NO_OVERFLOW: TabOverflow = { overflowing: false, atStart: true, atEnd: true };

/** Reads the tab region's overflow on resize and scroll; no polling. `watch` re-reads on a change. */
function useTabOverflow(
  list: { readonly current: HTMLElement | null },
  watch: readonly unknown[],
): { readonly overflow: TabOverflow; readonly measure: () => void } {
  const [overflow, setOverflow] = useState<TabOverflow>(NO_OVERFLOW);
  const measure = (): void => {
    const node = list.current;
    if (node === null) {
      return;
    }
    const next: TabOverflow = {
      overflowing: node.scrollWidth > node.clientWidth,
      atStart: node.scrollLeft <= 0,
      atEnd: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1,
    };
    setOverflow((prev) =>
      prev.overflowing === next.overflowing &&
      prev.atStart === next.atStart &&
      prev.atEnd === next.atEnd
        ? prev
        : next,
    );
  };
  useLayoutEffect(() => {
    measure();
    const node = list.current;
    if (node === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
    // `measure` closes over refs and a setter only; the watch list is what makes it re-run.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, watch);
  return { overflow, measure };
}

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
  const explorerOpen = surface === "explorer";
  const { overflow, measure } = useTabOverflow(list, [tabs.length, explorerOpen, root]);
  const maximized = dockMaximized.value;
  const canWiden = dockWideAffordable.value;

  const scrollTabs = (direction: 1 | -1): void => {
    const container = list.current;
    if (container === null) {
      return;
    }
    const step = container.querySelector<HTMLElement>('[role="tab"]')?.offsetWidth;
    container.scrollLeft += direction * (step || FALLBACK_SCROLL_STEP);
    measure();
  };

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
      className="flex h-[38px] shrink-0 items-center gap-1 border-b px-2"
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
        className="relative flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto [scrollbar-width:none]"
        onScroll={measure}
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
              "group/tab relative flex h-full shrink-0 items-center gap-1 px-2.5 text-xs",
              "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary",
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
      {overflow.overflowing ? (
        <>
          <ScrollArrow
            label="Scroll tabs left"
            icon={ArrowLeft01Icon}
            disabled={overflow.atStart}
            onPress={() => scrollTabs(-1)}
          />
          <ScrollArrow
            label="Scroll tabs right"
            icon={ArrowRight01Icon}
            disabled={overflow.atEnd}
            onPress={() => scrollTabs(1)}
          />
        </>
      ) : null}
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
      {dockNarrow.value ? null : (
        <>
          <Separator orientation="vertical" className="mx-1 h-4 self-center" />
          <Tooltip>
            {/* A disabled button takes no pointer events, so the span carries the tooltip. */}
            <TooltipTrigger render={<span className="shrink-0" />}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={maximized ? "Restore the panel width" : "Widen the panel"}
                aria-pressed={maximized}
                disabled={!maximized && !canWiden}
                className="text-muted-foreground"
                onClick={toggleDockMaximized}
              >
                <DeckIcon icon={maximized ? Minimize01Icon : Maximize01Icon} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {maximized
                ? "Restore the panel width"
                : canWiden
                  ? "Widen the panel"
                  : "The window is too narrow to widen the panel"}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function ScrollArrow({
  label,
  icon,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly icon: DeckGlyph;
  readonly disabled: boolean;
  onPress(): void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            disabled={disabled}
            className="shrink-0 text-muted-foreground"
            onClick={onPress}
          />
        }
      >
        <DeckIcon icon={icon} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
