import type { AgentOption } from "../lib/agent-catalog";
import type { DesktopPlatform } from "../lib/platform";
import { primaryModifierKeycap } from "../lib/shortcut-label";
import { normalizeWorkspacePath, workspaceLabel } from "../lib/workspace-label";
import type { RecentWorkspace } from "../lib/workspace-recents";
import type { RepositoryScan } from "../repositories/repository-client";
import type { AgentLaunchTarget, LaunchCommandOverride } from "../terminal/agent-launch-target";
import type { AgentLaunchRequest } from "../terminal/tab-manager-types";
import { formatShortAge } from "../ui/agent-rail-model";
import type { CommandBarProject } from "./command-bar-model";

/** A project older than this shows its age in the menu; a newer one shows none (LCH-5). */
const AGE_SHOWN_AFTER_MS = 24 * 60 * 60 * 1000;

export interface LauncherProjectsInput {
  /** Workspace history, most recent first. */
  readonly recents: readonly RecentWorkspace[];
  /** Workspaces of the live tabs: a project in use is listed even before history records it. */
  readonly livePaths: readonly string[];
  /** The workspace the launcher is aimed at; listed even when history does not know it. */
  readonly targetPath: string | null;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  readonly now: number;
}

export interface LauncherProjects {
  readonly projects: readonly CommandBarProject[];
  /** The target's path as the matching project spells it, so the bar can find its chip. */
  readonly currentPath: string | null;
}

function branchOf(path: string, scans: ReadonlyMap<string, RepositoryScan>): string | null {
  const scan = scans.get(path);
  if (scan?.kind !== "repository") return null;
  const wanted = normalizeWorkspacePath(path);
  return (
    scan.worktrees.find((entry) => normalizeWorkspacePath(entry.path) === wanted)?.branch ?? null
  );
}

/**
 * The bar's projects: history in recency order, then live workspaces history lacks, then the
 * target when neither knows it. Each carries its branch and, past a day, its short age.
 */
export function launcherProjects(input: LauncherProjectsInput): LauncherProjects {
  const seen = new Set<string>();
  const projects: CommandBarProject[] = [];
  const add = (path: string, lastOpenedAt: number | null): void => {
    const key = normalizeWorkspacePath(path);
    if (key === null || seen.has(key)) return;
    seen.add(key);
    const age =
      lastOpenedAt === null || input.now - lastOpenedAt < AGE_SHOWN_AFTER_MS
        ? null
        : formatShortAge(lastOpenedAt, input.now) || null;
    projects.push({
      path,
      name: workspaceLabel(path),
      branch: branchOf(path, input.scans),
      age,
    });
  };
  for (const recent of input.recents) add(recent.path, recent.lastOpenedAt);
  for (const path of input.livePaths) add(path, null);
  if (input.targetPath !== null) add(input.targetPath, null);
  const wanted = input.targetPath === null ? null : normalizeWorkspacePath(input.targetPath);
  const current =
    wanted === null
      ? undefined
      : projects.find((project) => normalizeWorkspacePath(project.path) === wanted);
  return { projects, currentPath: current?.path ?? null };
}

/**
 * The agent a visit to this project starts picked: the one it last ran. A shell, an unknown
 * agent or one that cannot run now picks nothing, and the bar then falls back to its first agent.
 */
export function launcherDefaultPick(
  recents: readonly RecentWorkspace[],
  path: string | null,
  agents: readonly AgentOption[],
): readonly string[] {
  const wanted = path === null ? null : normalizeWorkspacePath(path);
  if (wanted === null) return [];
  const last = recents.find((recent) => normalizeWorkspacePath(recent.path) === wanted)?.lastAgent;
  return typeof last === "string" && agents.some((agent) => agent.id === last && !agent.missing)
    ? [last]
    : [];
}

interface BesideTab {
  readonly key: number;
  readonly panes?: readonly { readonly paneId: number; readonly agent?: string | null }[];
}

/**
 * What the destination line says it sits beside. Only a split target is beside something: it is
 * the focused pane of the active space, in the same project. A pane with no agent is a shell.
 */
export function launcherBeside(
  target: AgentLaunchTarget | null,
  tabs: readonly BesideTab[],
  labelOf: (agentId: string) => string,
): string | null {
  if (target?.kind !== "split") return null;
  const agent = tabs
    .find((tab) => tab.key === target.tabKey)
    ?.panes?.find((pane) => pane.paneId === target.paneId)?.agent;
  return agent == null ? "Terminal" : labelOf(agent);
}

/** One request per picked agent, in the order picked, each with its profile override if any. */
export function launcherRequests(
  agentIds: readonly string[],
  overrides: Readonly<Record<string, LaunchCommandOverride>>,
): readonly AgentLaunchRequest[] {
  return agentIds.map((agentId) => {
    const override = overrides[agentId];
    return override === undefined ? { agentId } : { agentId, override };
  });
}

export type StageBarMode = "none" | "resident" | "floating";

export interface StageBarState {
  readonly stageLauncher: boolean;
  readonly liveTabCount: number;
  /** Documents and the browser on the stage count as something to float over. */
  readonly otherSurfaces: number;
  readonly boardOpen: boolean;
  readonly requestOpen: boolean;
  /** The open request began on an empty stage. */
  readonly requestResident?: boolean;
}

/**
 * How the command bar shows. Resident is the stage's own start surface (no live space, nothing
 * else on the stage); floating is the same bar raised over a live space. An open request that
 * began on an empty stage stays resident, so the bar does not change shape when its first pane
 * appears.
 */
export function stageBarMode(state: StageBarState): StageBarMode {
  if (!state.stageLauncher) return "none";
  const empty = state.liveTabCount === 0 && state.otherSurfaces === 0;
  if (state.requestOpen) return empty || state.requestResident === true ? "resident" : "floating";
  return empty && !state.boardOpen ? "resident" : "none";
}

/** The Open folder shortcut as key caps the platform writes: ⌘ O, or Ctrl O. */
export function openFolderKeys(platform: DesktopPlatform): readonly string[] {
  return [primaryModifierKeycap(platform), "O"];
}
