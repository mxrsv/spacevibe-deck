import type { AgentRailView, RailStreamGroup } from "./agent-rail-model";
import { needsUser } from "./worktree-card-row";

/**
 * The collapsed rail's avatar column as a pure projection of the tree's own
 * view (DL-27.29): one avatar per LIVE project, in the order the tree draws
 * them. It reads the same `AgentRailView` the expanded tree renders, so a
 * badge cannot disagree with the project header's needs-you count
 * (DL-27.27, amended) — both count the panes whose state is `asked` or
 * `failed`.
 */
export interface RailAvatar {
  /** `RailStreamGroup.key` — list identity. */
  readonly key: string;
  readonly project: string;
  /** The path the project's identity icon is scanned from; mirrors the header's. */
  readonly iconPath: string | null;
  /** Panes that need the user. Zero prints no badge. */
  readonly needCount: number;
  /** Any of those panes failed; the badge turns `--red`. */
  readonly failed: boolean;
  /** The project holds the selected tab, the cluster's `data-active`. */
  readonly current: boolean;
  /** The accessible name's tail, stated in words (DL-27.2). */
  readonly needWords: string;
}

function avatarOf(group: RailStreamGroup): RailAvatar {
  const needing = group.worktrees.flatMap((worktree) =>
    worktree.panes.filter((pane) => needsUser(pane.state)),
  );
  const failedCount = needing.filter((pane) => pane.state === "failed").length;
  const needCount = needing.length;
  return {
    key: group.key,
    project: group.project,
    iconPath: group.worktrees[0]?.repositoryPath ?? group.worktrees[0]?.path ?? group.path,
    needCount,
    failed: failedCount > 0,
    current: group.worktrees.some((worktree) => worktree.active),
    needWords:
      failedCount > 0
        ? `${needCount} need you, ${failedCount} failed`
        : `${needCount} need you`,
  };
}

/**
 * Remembered projects (nothing open in them) are left out: the column is live
 * work, and a header with no rows has nothing to open in a flyout. The order
 * is the stream's, which `buildAgentRail` already ran through the stored
 * `railOrder` (DL-27.20).
 */
export function buildRailAvatars(view: AgentRailView): readonly RailAvatar[] {
  return view.stream.filter((group) => group.tabIndexes.length > 0).map(avatarOf);
}
