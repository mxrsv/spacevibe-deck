import type { RepositoryScan } from "../repositories/repository-client";
import type { RailStreamGroup } from "../ui/agent-rail-model";
import { workspaceLabel } from "../lib/workspace-label";
import type { AgentLaunchTarget } from "../terminal/agent-launch-target";

export interface LaunchWorkspaceRow {
  readonly path: string;
  readonly label: string;
}

export interface LaunchCheckoutRow {
  readonly path: string;
  readonly label: string;
  /** Not the repository's primary checkout. */
  readonly linked: boolean;
}

/** What the launch page's context row prints, derived from the rail and the scans. */
export interface LaunchContextView {
  /** One row per project: live ones in rail order, then remembered ones. */
  readonly workspaces: readonly LaunchWorkspaceRow[];
  /** The row that stands for the target's project, or the target's own folder. */
  readonly workspacePath: string;
  /** Empty for a folder git does not know, or one not scanned yet (DL-19.7). */
  readonly checkouts: readonly LaunchCheckoutRow[];
  readonly checkoutPath: string;
  readonly chip: string;
}

/**
 * A project's row selects its checkout that holds the focused pane, else its
 * primary; a remembered project with no checkouts falls back to its history path.
 */
function rowFor(group: RailStreamGroup): LaunchWorkspaceRow | null {
  const checkout =
    group.worktrees.find((entry) => entry.active) ??
    group.worktrees.find((entry) => entry.primary) ??
    group.worktrees[0];
  const path = checkout?.path ?? group.path;
  return path === null ? null : { path, label: group.project };
}

function checkoutsOf(
  path: string,
  scans: ReadonlyMap<string, RepositoryScan>,
): readonly LaunchCheckoutRow[] {
  const scan = [scans.get(path), ...scans.values()].find(
    (entry) =>
      entry?.kind === "repository" &&
      entry.worktrees.some((item) => !item.bare && item.path === path),
  );
  if (scan?.kind !== "repository") return [];
  return scan.worktrees
    .filter((entry) => !entry.bare)
    .map((entry, index) => ({
      path: entry.path,
      label: entry.branch ?? workspaceLabel(entry.path),
      linked: index > 0,
    }));
}

/** `agentLabel` names the focused pane's agent when the target is a split. */
export function buildLaunchContext(input: {
  readonly stream: readonly RailStreamGroup[];
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  readonly target: AgentLaunchTarget;
  readonly agentLabel: string | null;
}): LaunchContextView {
  const { stream, scans, target } = input;
  const workspaces = stream.flatMap((group) => rowFor(group) ?? []);
  const owner = stream.find((group) =>
    group.worktrees.some((entry) => entry.path === target.workspacePath),
  );
  const row = owner === undefined ? undefined : rowFor(owner);
  return {
    workspaces,
    workspacePath: row?.path ?? target.workspacePath,
    checkouts: checkoutsOf(target.workspacePath, scans),
    checkoutPath: target.workspacePath,
    chip: target.kind === "split" ? `Split beside ${input.agentLabel ?? "terminal"}` : "New space",
  };
}
