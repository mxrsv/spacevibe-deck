import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import { workspaceLabel } from "../lib/workspace-label";
import type { RailStreamGroup, RailWorktreeGroup } from "./agent-rail-model";
import type { NewPaneDropDeps } from "./new-pane-drag";
import { RailCreateRow, type RailCreateVariant } from "./rail-create-row";
import { whereOf } from "./worktree-card-row";
import type { CardActions } from "./worktree-card-menus";

/**
 * The rail's create row and what its three verbs target (DL-27.14, amended
 * 2026-10-08). Mounted by `AgentRail` under the identity row in the expanded
 * tree and above the avatars in the collapsed column, so both variants read the
 * same focused checkout from the same stream.
 *
 * Electron only — `AgentRail` routes Tauri to `RepositoryRail`, which keeps its
 * pinned `New Workspace`.
 */

export interface RailCreateProps {
  readonly variant: RailCreateVariant;
  readonly stream: readonly RailStreamGroup[];
  /** `onOpenAgentLauncher` is the launch page; unwired (gallery), `Agent` opens the board. */
  readonly actions?: CardActions;
  readonly onOpenBoard: () => void;
  readonly disabled?: boolean;
  readonly newPaneDrop?: NewPaneDropDeps;
}

interface FocusedCheckout {
  readonly project: string;
  readonly group: RailWorktreeGroup;
}

/** The checkout holding the focused pane (RAIL1); none when a browser or dock surface has focus. */
function focusedCheckout(stream: readonly RailStreamGroup[]): FocusedCheckout | null {
  for (const cluster of stream) {
    const group = cluster.worktrees.find((worktree) => worktree.active);
    if (group !== undefined) {
      return { project: cluster.project, group };
    }
  }
  return null;
}

/** The active tab's workspace — the target when no pane is focused. */
function activeTabWorkspace(): string | null {
  return tabViews.value[activeTabIndex.value]?.workspacePath ?? null;
}

export function RailCreate({
  variant,
  stream,
  actions,
  onOpenBoard,
  disabled,
  newPaneDrop,
}: RailCreateProps) {
  const focused = focusedCheckout(stream);
  const workspace = focused === null ? activeTabWorkspace() : null;
  const agentPath = focused?.group.path ?? workspace;
  const agentWhere =
    focused !== null
      ? whereOf(focused.project, focused.group)
      : workspace !== null
        ? workspaceLabel(workspace)
        : null;

  const openAgent = (): void => {
    if (agentPath !== null && actions?.onOpenAgentLauncher !== undefined) {
      actions.onOpenAgentLauncher(agentPath);
      return;
    }
    onOpenBoard();
  };

  return (
    <RailCreateRow
      variant={variant}
      agentTitle={
        agentWhere === null
          ? "Open a workspace — or drag onto a pane to add an agent there"
          : `New agent in ${agentWhere} — or drag onto a pane`
      }
      disabled={disabled}
      newPaneDrop={newPaneDrop}
      onAgent={openAgent}
    />
  );
}
