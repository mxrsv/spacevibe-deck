/**
 * What the stage launcher's presses decide (spec 2026-11-04-launcher-in-stage). App owns the
 * signals and the tab manager; this module owns the choices between them, with every seam passed
 * in, in the style of `remembered-press.ts`, so each decision is testable without rendering App.
 */
import type { RememberedPane } from "../lib/session-schema";
import type {
  AgentLaunchReceipt,
  AgentLaunchResult,
  AgentLaunchTarget,
  LaunchCommandOverride,
} from "../terminal/agent-launch-target";
import type { AgentLaunchRequest, AgentsLaunchResult } from "../terminal/tab-manager-types";
import type { FreshStart } from "../ui/project-rail/remembered-press";
import { launcherRequests, type StageBarMode } from "./stage-launcher-props";

/** The head of the workspace history, as far as "was something added" needs to see it. */
export interface RecentHead {
  readonly path: string;
  readonly lastOpenedAt: number;
}

export interface StageLauncherActionDeps {
  setNotice(message: string | null): void;
  /** True while the agent launch request is open (the bar has captured a target). */
  hasRequest(): boolean;
  /** The project the resident bar is aimed at while no request holds a target. */
  residentPath(): string | null;
  /** The open request's target project, if a request is open. */
  requestPath(): string | null;
  beginRequest(path: string): void;
  runMany(requests: readonly AgentLaunchRequest[]): Promise<void> | void;
  /** Paths of the projects the rail lists now. */
  shownPaths(): readonly string[];
  rememberOnRail(path: string): void;
  /** Aim the bar (or the open request) at a project. */
  aim(path: string): void;
  /** The rail's Folder verb: a notice to print, or null. */
  addFolder(): Promise<string | null>;
  recentHead(): RecentHead | undefined;
  barMode(): StageBarMode;
  /** Raise the bar over a live space, aimed at `path`. */
  openLauncher(path: string): void;
  closeForm(): void;
  focusBar(): void;
  /** The repository's main checkout for a project path, or the path itself. */
  repoRootOf(path: string | null): string | null;
  /** Whether the rail is on screen to host its own worktree popover. */
  railVisible(): boolean;
  requestRailWorktreeForm(repo: string | null): void;
  openStageWorktreeForm(repo: string | null): void;
}

export interface StageLauncherActions {
  run(
    agentIds: readonly string[],
    overrides: Readonly<Record<string, LaunchCommandOverride>>,
  ): void;
  pickProject(path: string): void;
  openFolder(): Promise<void>;
  showAt(path: string): void;
  leaveForm(path: string | null): void;
  newWorktree(): void;
  retarget(path: string): boolean;
}

export function createStageLauncherActions(deps: StageLauncherActionDeps): StageLauncherActions {
  /** Aim the launcher at a project and make sure it is on screen. */
  function showAt(path: string): void {
    deps.aim(path);
    if (deps.barMode() === "none") deps.openLauncher(path);
  }

  return {
    // Run opens the request first when the resident bar has none yet.
    run(agentIds, overrides) {
      deps.setNotice(null);
      if (!deps.hasRequest()) {
        const path = deps.residentPath();
        if (path === null) return;
        deps.beginRequest(path);
      }
      void deps.runMany(launcherRequests(agentIds, overrides));
    },

    // A project the rail does not list joins it first, at the top of recency (LCH-5).
    pickProject(path) {
      deps.setNotice(null);
      if (!deps.shownPaths().includes(path)) deps.rememberOnRail(path);
      deps.aim(path);
    },

    // A cancelled picker leaves the head untouched; an added or re-added folder becomes the
    // head with a fresh `lastOpenedAt`, so compare by value, not by object identity.
    async openFolder() {
      const before = deps.recentHead();
      deps.setNotice(await deps.addFolder());
      const head = deps.recentHead();
      if (head === undefined) return;
      if (before?.path === head.path && before.lastOpenedAt === head.lastOpenedAt) return;
      showAt(head.path);
    },

    showAt,

    // A stage form is done (LCH-8): `path` is the workspace it made; a cancel goes back.
    leaveForm(path) {
      deps.closeForm();
      if (path !== null) showAt(path);
      else deps.focusBar();
    },

    // The rail's popover while the rail is on screen, else the stage's own form.
    newWorktree() {
      const repo = deps.repoRootOf(deps.requestPath() ?? deps.residentPath());
      if (deps.railVisible()) deps.requestRailWorktreeForm(repo);
      else deps.openStageWorktreeForm(repo);
    },

    // A press on a project header while a bar is up aims it; false when none is up.
    retarget(path) {
      if (deps.barMode() === "none") return false;
      deps.aim(path);
      return true;
    },
  };
}

export interface LaunchManyDeps {
  /** The project's choice is the launch now; a resident bar must not keep an older one. */
  clearChoice(): void;
  /** The folder's remembered agent is the one last run there. */
  recordOpen(workspacePath: string, agentId: string): void;
  /** Name the new space for its folder and the first agent. */
  nameNewSpace(tabKey: number, workspacePath: string, agentId: string): void;
}

/**
 * After the command bar's Run: the first receipt settles the bar (choice cleared, last agent
 * recorded), and a space made on a new-space target is named even when a later agent failed,
 * because its first pane exists. A split names nothing.
 */
export function settleLaunchMany(
  result: AgentsLaunchResult,
  agents: readonly AgentLaunchRequest[],
  target: AgentLaunchTarget,
  deps: LaunchManyDeps,
): AgentsLaunchResult {
  const first = result.receipts[0];
  if (first === undefined) return result;
  deps.clearChoice();
  deps.recordOpen(target.workspacePath, agents[0].agentId);
  if (target.kind === "new-space") {
    deps.nameNewSpace(first.tabKey, target.workspacePath, agents[0].agentId);
  }
  return result;
}

export interface StartFreshDeps {
  launch(
    target: AgentLaunchTarget,
    agentId: string,
    override: LaunchCommandOverride | undefined,
  ): Promise<AgentLaunchResult>;
  nameNewSpace(tabKey: number, workspacePath: string, agentId: string): void;
  reveal(receipt: AgentLaunchReceipt): void;
}

/**
 * A remembered row whose conversation is gone starts its agent fresh. It opens one new space in
 * the row's workspace (the one resume uses), not in the pane's own cwd: a new-space target
 * carries only a workspace path.
 */
export async function startFreshInWorkspace(
  entry: Pick<RememberedPane, "workspacePath">,
  request: { readonly agentId: string; readonly override?: LaunchCommandOverride },
  deps: StartFreshDeps,
): Promise<FreshStart> {
  const result = await deps.launch(
    { kind: "new-space", workspacePath: entry.workspacePath },
    request.agentId,
    request.override,
  );
  if (result.kind !== "spawned") {
    return { ok: false, message: result.kind === "failed" ? result.message : undefined };
  }
  deps.nameNewSpace(result.receipt.tabKey, entry.workspacePath, request.agentId);
  deps.reveal(result.receipt);
  return { ok: true };
}

/**
 * The paths a `dirs_exist` probe did not confirm. Fails closed: a short or missing answer counts
 * as missing, so a probe that cannot answer never lets a resume run in a folder that may be gone.
 */
export function missingPaths(
  paths: readonly string[],
  exists: readonly boolean[] | undefined,
): Set<string> {
  return new Set(paths.filter((_, index) => exists?.[index] !== true));
}
