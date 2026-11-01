import {
  Archive02Icon,
  Cancel01Icon,
  Copy01Icon,
  Edit02Icon,
  FolderOpenIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  Pin02Icon,
  PlusSignIcon,
  Unarchive03Icon,
} from "@hugeicons/core-free-icons";
import { useRef } from "preact/hooks";
import { cn } from "@/lib/cn";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import type { RowCommands } from "./project-rail-commands";
import { ProjectRailCheckoutRows } from "./project-rail-checkout";
import { MenuEntry, RailPopupGuard, REVEAL, Tip } from "./project-rail-menu-parts";
import { recoverRailFocus } from "./project-rail-focus";

export interface ProjectRailRowActionsProps {
  /** The row's title, so every button names the row it acts on. */
  readonly title: string;
  readonly pinned: boolean;
  /** The row Tab reaches; the other rows' buttons wait behind the arrow keys and the menu. */
  readonly tabStop: boolean;
  readonly commands: RowCommands;
  /** Controlled, so the right-click opens the same menu as the more button. */
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  /** Start renaming; called once the menu has finished closing and returned focus. */
  readonly onRename: () => void;
}

/** Pin, archive and the more menu, laid over the row's trailing edge (LAY-2). */
export function ProjectRailRowActions({
  title,
  pinned,
  tabStop,
  commands,
  menuOpen,
  onMenuOpenChange,
  onRename,
}: ProjectRailRowActionsProps) {
  const tabIndex = tabStop ? 0 : -1;
  const pinLabel = pinned ? "Unpin" : "Pin";
  const archiveLabel = commands.archived ? "Unarchive" : "Archive";
  const archiveIcon = commands.archived ? Unarchive03Icon : Archive02Icon;
  // The menu hands focus back to its trigger as it closes, and the field would lose it to that.
  const renameWhenClosed = useRef(false);
  return (
    <div
      className={cn(
        "absolute top-1 right-1.5 flex items-center gap-0.5 rounded-md bg-accent p-0.5",
        REVEAL,
      )}
    >
      {commands.pin === undefined ? null : (
        <Tip
          label={pinLabel}
          button={
            <Button
              variant="ghost"
              size="icon-xs"
              tabIndex={tabIndex}
              aria-label={`${pinLabel} ${title}`}
              onClick={commands.pin}
            />
          }
        >
          <DeckIcon icon={Pin02Icon} />
        </Tip>
      )}
      <Tip
        label={archiveLabel}
        button={
          <Button
            variant="ghost"
            size="icon-xs"
            tabIndex={tabIndex}
            aria-label={`${archiveLabel} ${title}`}
            onClick={commands.archive}
          />
        }
      >
        <DeckIcon icon={archiveIcon} />
      </Tip>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        onOpenChangeComplete={(open: boolean) => {
          if (open) {
            return;
          }
          if (renameWhenClosed.current) {
            renameWhenClosed.current = false;
            onRename();
          }
          // The row an entry removed took the menu's trigger, and focus, with it.
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
                  aria-label={`More actions for ${title}`}
                />
              }
            />
          }
        >
          <DeckIcon icon={MoreHorizontalIcon} />
        </Tip>
        <DropdownMenuContent align="end" className="min-w-44">
          <RailPopupGuard />
          {commands.rename === undefined ? null : (
            <MenuEntry
              icon={Edit02Icon}
              onClick={() => {
                renameWhenClosed.current = true;
              }}
            >
              Rename
            </MenuEntry>
          )}
          {commands.pin === undefined ? null : (
            <MenuEntry icon={Pin02Icon} onClick={commands.pin}>
              {pinLabel}
            </MenuEntry>
          )}
          <DropdownMenuSeparator />
          <MenuEntry icon={Copy01Icon} onClick={commands.copyPath}>
            Copy path
          </MenuEntry>
          <MenuEntry
            icon={GitBranchIcon}
            disabled={commands.copyBranch === undefined}
            onClick={() => commands.copyBranch?.()}
          >
            Copy branch
          </MenuEntry>
          {commands.openFolder === undefined ? null : (
            <MenuEntry icon={FolderOpenIcon} onClick={commands.openFolder}>
              Open in {commands.openFolderLabel}
            </MenuEntry>
          )}
          {commands.checkoutActions.length === 0 ? null : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DeckIcon icon={PlusSignIcon} />
                New here
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <ProjectRailCheckoutRows groups={commands.checkoutActions} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <MenuEntry icon={archiveIcon} onClick={commands.archive}>
            {archiveLabel}
          </MenuEntry>
          <MenuEntry icon={Cancel01Icon} variant="destructive" onClick={commands.close}>
            Close
          </MenuEntry>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
