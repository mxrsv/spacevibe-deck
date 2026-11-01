import { FolderPlus, GitFork, Plus, UserPlus } from "@phosphor-icons/react";
import type { RefObject } from "preact";
import { useRef } from "preact/hooks";
import { available as worktreeHostAvailable } from "../../host/worktree-host";
import type { RailStreamGroup } from "../agent-rail-model";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../controls/dropdown-menu";
import { addFolderToRail } from "../rail-add-folder";
import { activeTabWorkspace, focusedCheckout } from "../rail-create";
import type { CardActions } from "../worktree-card-menus";
import { launchAgent } from "./project-rail-commands";
import { MenuEntry, RailPopupGuard, Tip } from "./project-rail-menu-parts";

export interface ProjectRailCreateProps {
  readonly stream: readonly RailStreamGroup[];
  /** `onOpenAgentLauncher` is the launch page; unwired, New agent opens the board. */
  readonly actions?: CardActions;
  readonly onOpenBoard: () => void;
  readonly disabled?: boolean;
  /** Where the folder picker's refusals are printed; `null` clears the last one. */
  readonly onNotice: (notice: string | null) => void;
  /** Open the worktree form; called once the menu has closed and let go of focus. */
  readonly onNewWorktree: () => void;
  /** The "+" button, for the form to hand focus back to. */
  readonly plusRef: RefObject<HTMLButtonElement>;
}

/**
 * The "+" menu (LAY-3): New agent, New worktree and Open folder, the three verbs of the
 * shipped create row with the same targets (`rail-create.tsx`): the focused checkout, else the
 * active tab's workspace. The worktree form opens in a popover under the button once the
 * menu has closed (`onNewWorktree`); `ProjectRailControls` hosts it.
 */
export function ProjectRailCreate({
  stream,
  actions,
  onOpenBoard,
  disabled,
  onNotice,
  onNewWorktree,
  plusRef,
}: ProjectRailCreateProps) {
  // Set when "New worktree" is picked. The form opens once the menu has closed (`formDue`), and
  // the menu then leaves focus alone (`chosen`): the form's branch field takes it instead.
  const formDue = useRef(false);
  const chosen = useRef(false);

  const focused = focusedCheckout(stream);
  const agentPath = focused?.group.path ?? (focused === null ? activeTabWorkspace() : null);
  const openAgent = (): void => launchAgent(agentPath, actions, onOpenBoard);

  return (
    <div className="relative shrink-0">
      <DropdownMenu
        onOpenChange={(open: boolean) => {
          if (open) {
            chosen.current = false;
          }
        }}
        onOpenChangeComplete={(open: boolean) => {
          if (!open && formDue.current) {
            formDue.current = false;
            onNewWorktree();
          }
        }}
      >
        <Tip
          label="New"
          button={
            <DropdownMenuTrigger
              render={<Button ref={plusRef} variant="ghost" size="icon" aria-label="New" />}
            />
          }
        >
          <DeckIcon icon={Plus} size={ROW_ICON} />
        </Tip>
        <DropdownMenuContent align="end" className="min-w-44" finalFocus={() => !chosen.current}>
          <RailPopupGuard />
          <MenuEntry icon={UserPlus} disabled={disabled} onClick={openAgent}>
            New agent
          </MenuEntry>
          {worktreeHostAvailable ? (
            <MenuEntry
              icon={GitFork}
              onClick={() => {
                onNotice(null);
                formDue.current = true;
                chosen.current = true;
              }}
            >
              New worktree
            </MenuEntry>
          ) : null}
          <MenuEntry
            icon={FolderPlus}
            onClick={() => {
              onNotice(null);
              void addFolderToRail().then(onNotice);
            }}
          >
            Open folder
          </MenuEntry>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
