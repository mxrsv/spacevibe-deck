/**
 * What a project header's "+" and menu do. Like the row commands, each one calls something that
 * exists: the launch path of the "+" menu's New agent, the `railOrder` setting the old drag
 * wrote (through its own `pinAt`), the session mark that hides a project, and the two host
 * callbacks the shipped header's ✕ called. Nothing here decides how tabs close (R4).
 */
import { repositoryScans } from "../../repositories/repositories-store";
import { settings, updateSettings } from "../../settings/settings-store";
import type { RailStreamGroup } from "../agent-rail-model";
import { pinAt, sameRailOrder } from "../rail-order";
import type { RailGroup } from "../rail-view-model";
import { launchAgent, type RailRowDeps } from "./project-rail-commands";
import { setRailProjectHidden } from "./project-rail-state";

/** The host callbacks `AgentRail` already receives, handed through unchanged. */
export interface ProjectDeps extends RailRowDeps {
  onCloseProject?(tabIndexes: readonly number[], historyPaths: readonly string[]): void;
  onRemoveWorkspace?(workspacePaths: readonly string[]): void;
  onOpenBoard(): void;
  /** The shipped Agent button's disabled state, kept for the header's "+". */
  readonly agentDisabled?: boolean;
}

export interface ProjectRemoval {
  /** Tabs it closes; 0 for a remembered project, which only leaves the rail. */
  readonly tabCount: number;
  run(): void;
}

export interface ProjectCommands {
  newAgent(): void;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  moveUp(): void;
  moveDown(): void;
  hide(): void;
  /** Absent where nothing wires the host callback: omitted rather than inert, as the shipped header. */
  readonly removal?: ProjectRemoval;
}

/**
 * Write the order one step up or down, as a drop of that cluster onto its visible neighbour's
 * slot would. Hidden projects are stepped over; a twinned cluster, which `pinAt` cannot place,
 * writes nothing (the old drag had the same limit).
 */
function moveProject(
  stream: readonly RailStreamGroup[],
  visibleKeys: readonly string[],
  key: string,
  step: -1 | 1,
): void {
  const neighbour = visibleKeys[visibleKeys.indexOf(key) + step];
  if (neighbour === undefined) {
    return;
  }
  const current = settings.value.railOrder;
  const next = pinAt({
    stream,
    from: stream.findIndex((group) => group.orderKey === key),
    to: stream.findIndex((group) => group.orderKey === neighbour),
    railOrder: current,
    scans: repositoryScans.value,
  });
  if (!sameRailOrder(next, current)) {
    updateSettings({ railOrder: next });
  }
}

/** One project's commands for each shown group, by project key. */
export function projectCommandsFor(
  groups: readonly RailGroup[],
  stream: readonly RailStreamGroup[],
  deps: ProjectDeps,
): ReadonlyMap<string, ProjectCommands> {
  const keys = groups.map((group) => group.key);
  return new Map(
    groups.map((group, at) => {
      // A repository can stand as a live cluster and a remembered twin; the project is both.
      const owned = stream.filter((cluster) => cluster.orderKey === group.key);
      const checkouts = owned.flatMap((cluster) => cluster.worktrees);
      const home = checkouts.find((checkout) => checkout.primary) ?? checkouts[0];
      const path = home?.path ?? owned[0]?.historyPaths[0] ?? null;
      const tabIndexes = owned.flatMap((cluster) => cluster.tabIndexes);
      const historyPaths = [...new Set(owned.flatMap((cluster) => cluster.historyPaths))];
      const { onCloseProject, onRemoveWorkspace } = deps;
      let removal: ProjectRemoval | undefined;
      if (tabIndexes.length > 0) {
        removal =
          onCloseProject === undefined
            ? undefined
            : {
                tabCount: tabIndexes.length,
                run: () => onCloseProject(tabIndexes, historyPaths),
              };
      } else if (onRemoveWorkspace !== undefined && historyPaths.length > 0) {
        removal = { tabCount: 0, run: () => onRemoveWorkspace(historyPaths) };
      }
      return [
        group.key,
        {
          newAgent: () => launchAgent(path, deps.cardActions, deps.onOpenBoard),
          canMoveUp: at > 0,
          canMoveDown: at < keys.length - 1,
          moveUp: () => moveProject(stream, keys, group.key, -1),
          moveDown: () => moveProject(stream, keys, group.key, 1),
          hide: () => setRailProjectHidden(group.key, true),
          removal,
        } satisfies ProjectCommands,
      ];
    }),
  );
}
