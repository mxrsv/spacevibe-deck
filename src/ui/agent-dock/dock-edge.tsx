import { Cancel01Icon, SidebarRightIcon } from "@hugeicons/core-free-icons";
import { AgentStateMark } from "../blocks/agent-state-mark";
import { displayAgent } from "../agent-rail-card-model";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../controls/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { shortcutLabel } from "../../lib/shortcut-label";
import { Kbd } from "../controls/kbd";
import { statusLabel } from "../project-rail/project-rail-model";
import type { RailItem } from "../rail-view-model";
import { dockSheetOpen, takeAfterSheetClose } from "./agent-dock-state";
import { DockColumn, type DockColumnProps } from "./dock-column";

const OPEN_LABEL = "Open the side panel";
const HIDE_LABEL = "Hide the side panel";

/** The handle's accessible name: the way in, and which agent it would show. */
function handleLabel(item: RailItem | null, changed: number | null): string {
  const changes =
    changed === null ? "" : `, ${changed} changed ${changed === 1 ? "file" : "files"}`;
  if (item === null || item.entry.kind !== "agent") {
    return `${OPEN_LABEL}${changes}`;
  }
  return `${OPEN_LABEL}, ${displayAgent(item.entry.agent)}, ${statusLabel(item)}${changes}`;
}

type DockEdgeProps = Pick<DockColumnProps, "item" | "space" | "root" | "cwd" | "bodies"> & {
  /** Hides the whole dock, as the toggle does: the sheet's own control closes the sheet only. */
  readonly onHide: () => void;
};

/**
 * The narrow rule (LAY-9, OD-4): under 1360px the dock is a 32px handle, and opening it draws the
 * same column in a sheet over the stage with its scrim. Escape or the scrim closes it and focus
 * returns to the handle. The handle is the sheet's trigger, so Base UI owns that return.
 *
 * The sheet's own header control closes the sheet only; the handle's own "x" hides the dock, through
 * the same action as the toggle, so a narrow window needs no chord to put the column away.
 */
export function DockEdge({ item, space, root, cwd, bodies, onHide }: DockEdgeProps) {
  const changed = bodies.changes?.count(root) ?? null;
  const setOpen = (open: boolean): void => {
    dockSheetOpen.value = open;
  };
  return (
    <Sheet open={dockSheetOpen.value} onOpenChange={setOpen}>
      <div className="flex h-full flex-col items-center">
        <div aria-hidden="true" className="agent-dock__edge-head w-full" />
        <div className="flex flex-col items-center gap-2 py-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <SheetTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label={handleLabel(item, changed)} />
                  }
                />
              }
            >
              <DeckIcon icon={SidebarRightIcon} />
            </TooltipTrigger>
            <TooltipContent side="left">{OPEN_LABEL}</TooltipContent>
          </Tooltip>
          {item === null ? null : (
            <AgentStateMark status={item.status} confidence={item.confidence} />
          )}
          {changed === null ? null : (
            <span aria-hidden="true" className="text-xs tabular-nums text-foreground">
              {changed}
            </span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="mt-auto mb-2"
                aria-label={HIDE_LABEL}
                onClick={onHide}
              />
            }
          >
            <DeckIcon icon={Cancel01Icon} />
          </TooltipTrigger>
          <TooltipContent side="left">
            {HIDE_LABEL}
            <Kbd>{shortcutLabel("toggle-dock")}</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
      <SheetContent
        showCloseButton={false}
        className="data-[side=right]:w-80 data-[side=right]:sm:max-w-80"
        // Escape, the scrim and the close control return focus to the handle. A close that left an
        // action (a file press showing its diff) runs it instead and leaves focus where it puts it.
        finalFocus={() => {
          const action = takeAfterSheetClose();
          action?.();
          return action === null;
        }}
      >
        <SheetTitle className="sr-only">Side panel</SheetTitle>
        <DockColumn
          item={item}
          space={space}
          root={root}
          cwd={cwd}
          bodies={bodies}
          closeLabel="Close the side panel"
          closeChord={null}
          onClose={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
