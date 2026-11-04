import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { useRef } from "preact/hooks";
import { cn } from "@/lib/cn";
import { rowActionsGround } from "../blocks/recipe-classes";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGap,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import { recoverRailFocus } from "./project-rail-focus";
import { MenuEntry, RailPopupGuard, REVEAL_HEADER, Tip } from "./project-rail-menu-parts";
import type { ProjectCommands } from "./project-rail-project-commands";

export interface ProjectRailHeaderActionsProps {
  readonly name: string;
  /** The header the keyboard stands on: its buttons are in the Tab order. */
  readonly tabbable: boolean;
  readonly commands: ProjectCommands;
  readonly agentDisabled?: boolean;
  /** Controlled, so the right-click opens the same menu as the more button. */
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  /** Ask to remove the project; called once the menu has finished closing. */
  onRemove(): void;
}

/** "+" and the more menu, over the header's trailing edge (LAY-3). */
export function ProjectRailHeaderActions({
  name,
  tabbable,
  commands,
  agentDisabled,
  menuOpen,
  onMenuOpenChange,
  onRemove,
}: ProjectRailHeaderActionsProps) {
  const tabIndex = tabbable ? 0 : -1;
  // The menu hands focus back to its trigger as it closes; the dialog must open after that.
  const removeWhenClosed = useRef(false);
  return (
    <div className={cn(rowActionsGround(false), REVEAL_HEADER)}>
      <Tip
        label="New agent"
        button={
          <Button
            variant="ghost"
            size="icon-sm"
            tabIndex={tabIndex}
            disabled={agentDisabled}
            aria-label={`New agent in ${name}`}
            onClick={commands.newAgent}
          />
        }
      >
        <DeckIcon icon={PlusSignIcon} />
      </Tip>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        onOpenChangeComplete={(open: boolean) => {
          if (open) {
            return;
          }
          if (removeWhenClosed.current) {
            removeWhenClosed.current = false;
            onRemove();
          }
          // Hide took the header, and the menu's trigger, off the page.
          recoverRailFocus();
        }}
      >
        <Tip
          label="More"
          button={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  tabIndex={tabIndex}
                  aria-label={`${name} menu`}
                />
              }
            />
          }
        >
          <DeckIcon icon={MoreHorizontalIcon} />
        </Tip>
        <DropdownMenuContent align="end" className="min-w-40">
          <RailPopupGuard />
          <MenuEntry icon={ArrowUp01Icon} disabled={!commands.canMoveUp} onClick={commands.moveUp}>
            Move up
          </MenuEntry>
          <MenuEntry
            icon={ArrowDown01Icon}
            disabled={!commands.canMoveDown}
            onClick={commands.moveDown}
          >
            Move down
          </MenuEntry>
          <DropdownMenuGap />
          <MenuEntry icon={ViewOffIcon} onClick={commands.hide}>
            Hide
          </MenuEntry>
          {commands.removal === undefined ? null : (
            <MenuEntry
              icon={Delete02Icon}
              variant="destructive"
              onClick={() => {
                removeWhenClosed.current = true;
              }}
            >
              Remove
            </MenuEntry>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
