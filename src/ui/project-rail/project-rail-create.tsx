import {
  Clock01Icon,
  Download01Icon,
  FolderAddIcon,
  FolderLibraryIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PlusSignIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import type { RefObject } from "preact";
import { useRef } from "preact/hooks";
import { available as cloneHostAvailable } from "../../host/clone-host";
import { available as workspaceCreateAvailable } from "../../host/workspace-create-host";
import { available as worktreeHostAvailable } from "../../host/worktree-host";
import { openStageForm, type StageFormKind } from "../../launcher/stage-launcher-form-store";
import { stageLauncherEnabled } from "../../launcher/stage-launcher-enabled";
import { sessionsSupported } from "../../sessions/sessions-store";
import type { RailStreamGroup } from "../agent-rail-model";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
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
 *
 * With `stageLauncher` on it also holds what the Open board held (spec LCH-8), in the mock's
 * order: Open folder…, Clone repository…, New worktree…, Create workspace…, and the session
 * list. Clone, Create and the session list render in the stage (`openStageForm`).
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

  const openWorktree = (): void => {
    onNotice(null);
    formDue.current = true;
    chosen.current = true;
  };
  // The form takes the keyboard in the stage, so the menu does not hand focus back to "+".
  const openInStage = (kind: StageFormKind): void => {
    onNotice(null);
    chosen.current = true;
    openStageForm(kind);
  };
  const openFolder = (): void => {
    onNotice(null);
    void addFolderToRail().then(onNotice);
  };

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
              render={<Button ref={plusRef} variant="outline" size="icon" aria-label="New" />}
            />
          }
        >
          <DeckIcon icon={PlusSignIcon} />
        </Tip>
        <DropdownMenuContent align="end" className="min-w-44" finalFocus={() => !chosen.current}>
          <RailPopupGuard />
          <MenuEntry icon={UserAdd01Icon} disabled={disabled} onClick={openAgent}>
            New agent
          </MenuEntry>
          {stageLauncherEnabled() ? (
            <>
              <MenuEntry icon={FolderOpenIcon} onClick={openFolder}>
                Open folder…
              </MenuEntry>
              {cloneHostAvailable ? (
                <MenuEntry icon={Download01Icon} onClick={() => openInStage("clone")}>
                  Clone repository…
                </MenuEntry>
              ) : null}
              {worktreeHostAvailable ? (
                <MenuEntry icon={GitBranchIcon} onClick={openWorktree}>
                  New worktree…
                </MenuEntry>
              ) : null}
              {workspaceCreateAvailable ? (
                <MenuEntry icon={FolderLibraryIcon} onClick={() => openInStage("create")}>
                  Create workspace…
                </MenuEntry>
              ) : null}
              {sessionsSupported.value ? (
                <MenuEntry icon={Clock01Icon} onClick={() => openInStage("sessions")}>
                  Resume a session…
                </MenuEntry>
              ) : null}
            </>
          ) : (
            <>
              {worktreeHostAvailable ? (
                <MenuEntry icon={GitBranchIcon} onClick={openWorktree}>
                  New worktree
                </MenuEntry>
              ) : null}
              <MenuEntry icon={FolderAddIcon} onClick={openFolder}>
                Open folder
              </MenuEntry>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
