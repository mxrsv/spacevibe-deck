import type { AgentOption } from "../lib/agent-catalog";
import type { LaunchCommandChoices } from "../lib/launch-command";
import { getDesktopEnvironment } from "../lib/platform";
import type { RecentWorkspace } from "../lib/workspace-recents";
import type { RepositoryScan } from "../repositories/repository-client";
import type { AgentLaunchTarget, LaunchCommandOverride } from "../terminal/agent-launch-target";
import { CommandBar } from "./command-bar";
import {
  launcherBeside,
  launcherDefaultPick,
  launcherProjects,
  openFolderKeys,
  type StageBarMode,
} from "./stage-launcher-props";
import { StageLauncherSlot } from "./stage-launcher-slot";

export interface StageLauncherBarProps {
  readonly mode: Exclude<StageBarMode, "none">;
  /** The workspace the bar is aimed at: the request's, else the resident bar's own choice. */
  readonly targetPath: string | null;
  /** The request's target, which says whether a run splits beside a pane. */
  readonly target: AgentLaunchTarget | null;
  readonly recents: readonly RecentWorkspace[];
  readonly livePaths: readonly string[];
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  readonly tabs: readonly {
    readonly key: number;
    readonly panes?: readonly { readonly paneId: number; readonly agent?: string | null }[];
  }[];
  readonly now: number;
  readonly agents: readonly AgentOption[];
  readonly commands: Readonly<Record<string, LaunchCommandChoices>>;
  readonly pending: boolean;
  readonly failure: string | null;
  readonly active: boolean;
  onRun(
    agentIds: readonly string[],
    overrides: Readonly<Record<string, LaunchCommandOverride>>,
  ): void;
  onPickProject(path: string): void;
  onOpenFolder(): void;
  onNewWorktree(): void;
  onClone(): void;
  onRetry(): void;
  onClose(): void;
  onEditProfiles(): void;
}

/**
 * The stage's command bar (LCH-4, LCH-5) fed from the stores' data: the projects in recency
 * order, the target project's remembered agent, and the agent the bar sits beside. The same bar
 * is the resident start surface and, over a live space, the floating one.
 */
export function StageLauncherBar(props: StageLauncherBarProps) {
  const { projects, currentPath } = launcherProjects({
    recents: props.recents,
    livePaths: props.livePaths,
    targetPath: props.targetPath,
    scans: props.scans,
    now: props.now,
  });
  const labelOf = (agentId: string): string =>
    props.agents.find((agent) => agent.id === agentId)?.label ?? agentId;
  return (
    <StageLauncherSlot floating={props.mode === "floating"}>
      <CommandBar
        projects={projects}
        currentPath={currentPath}
        agents={props.agents}
        commands={props.commands}
        defaultPick={launcherDefaultPick(props.recents, currentPath, props.agents)}
        beside={launcherBeside(props.target, props.tabs, labelOf)}
        floating={props.mode === "floating"}
        firstRun={projects.length === 0}
        pending={props.pending}
        failure={props.failure}
        active={props.active}
        openFolderKeys={openFolderKeys(getDesktopEnvironment().platform)}
        onRun={props.onRun}
        onPickProject={props.onPickProject}
        onOpenFolder={props.onOpenFolder}
        onNewWorktree={props.onNewWorktree}
        onClone={props.onClone}
        onRetry={props.onRetry}
        onClose={props.onClose}
        onEditProfiles={props.onEditProfiles}
      />
    </StageLauncherSlot>
  );
}
