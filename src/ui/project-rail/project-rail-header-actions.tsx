import { ArrowDown, ArrowUp, DotsThree, EyeSlash, Plus, Trash } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import { cn } from "@/lib/cn";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
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
    <div className={cn("absolute top-1 right-1 flex items-center gap-0.5", REVEAL_HEADER)}>
      <Tip
        label="New agent"
        button={
          <Button
            variant="ghost"
            size="icon-xs"
            tabIndex={tabIndex}
            disabled={agentDisabled}
            aria-label={`New agent in ${name}`}
            onClick={commands.newAgent}
          />
        }
      >
        <DeckIcon icon={Plus} size={ROW_ICON} />
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
                  size="icon-xs"
                  tabIndex={tabIndex}
                  aria-label={`${name} menu`}
                />
              }
            />
          }
        >
          <DeckIcon icon={DotsThree} size={ROW_ICON} />
        </Tip>
        <DropdownMenuContent align="end" className="min-w-40">
          <RailPopupGuard />
          <MenuEntry icon={ArrowUp} disabled={!commands.canMoveUp} onClick={commands.moveUp}>
            Move up
          </MenuEntry>
          <MenuEntry icon={ArrowDown} disabled={!commands.canMoveDown} onClick={commands.moveDown}>
            Move down
          </MenuEntry>
          <DropdownMenuSeparator />
          <MenuEntry icon={EyeSlash} onClick={commands.hide}>
            Hide
          </MenuEntry>
          {commands.removal === undefined ? null : (
            <MenuEntry
              icon={Trash}
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
