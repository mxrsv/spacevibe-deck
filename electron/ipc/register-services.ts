/**
 * Renderer-facing services: git/worktree info, session resume lookup, agent
 * detection, desktop environment, editor/file links, prompt assets, images,
 * token usage and session history, plus the accelerator-suspend signal a
 * Shortcuts row sends while recording a chord.
 */
import path from "node:path";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { CHANNELS } from "./channels";
import { detectAgentsSafely, dirsExist } from "../agents";
import { gitBranch } from "../git";
import { scanRepository } from "../worktrees";
import { addWorktree } from "../git/worktree";
import { readStarState, starRepository } from "../github-star";
import { resolveResume, validateResumeRequests } from "../resume/resolve";
import { resolveSessionTails } from "../resume/session-tail";
import { listSessions } from "../sessions/list";
import { resolvePaths, openEditor } from "../links";
import { listExternalApps, openInApp } from "../external-apps";
import { workspaceForPath } from "../fs/workspace-for-path";
import { listPromptAssets } from "../prompt-assets";
import { readImageAsDataUrl, scanWorkspaceFavicon } from "../images";
import { createUsageService } from "../usage/service";
import { USAGE_CACHE_FILE } from "../usage/model";

export interface RegisterServicesDeps {
  readonly labelOf: (event: IpcMainInvokeEvent) => string;
  readonly setRecording: (senderId: number, recording: boolean) => void;
}

export function registerServices(deps: RegisterServicesDeps): void {
  ipcMain.handle(CHANNELS.gitBranch, (_event, { cwd }) => gitBranch(cwd));
  // Never rejects: every failure arrives as a `plain` scan, so the rail degrades
  // to the flat folder list Deck already shows rather than raising an error.
  ipcMain.handle(CHANNELS.gitRepository, (_event, { path: repoPath }) => scanRepository(repoPath));
  ipcMain.handle(CHANNELS.worktreeAdd, (_event, { repoPath, branch, destPath }) =>
    addWorktree({ repoPath, branch, destPath }),
  );
  // Neither rejects: "Star on GitHub" degrades to opening the repository page,
  // so an absent or signed-out `gh` is an ordinary answer, not an error.
  ipcMain.handle(CHANNELS.githubStarState, () => readStarState());
  ipcMain.handle(CHANNELS.githubStar, () => starRepository());
  ipcMain.handle(CHANNELS.resumeLookup, (_event, { requests }) =>
    resolveResume(app.getPath("home"), validateResumeRequests(requests)),
  );
  // Same payload and the same validator as `resume_lookup` above — the rail
  // asks the same question restore does, and answers with what the session
  // said rather than its id.
  ipcMain.handle(CHANNELS.sessionTail, (_event, { requests }) =>
    resolveSessionTails(app.getPath("home"), validateResumeRequests(requests)),
  );
  ipcMain.handle(CHANNELS.windowLabel, (event) => deps.labelOf(event));
  ipcMain.handle(CHANNELS.detectAgents, (_event, { names }) => detectAgentsSafely(names ?? []));
  ipcMain.handle(CHANNELS.dirsExist, (_event, { paths }) => dirsExist(paths));
  ipcMain.handle(CHANNELS.desktopEnvironment, () => ({
    // `homeDir`, not `home`: Rust's struct is `#[serde(rename_all = "camelCase")]`
    // so that has always been the wire key. `platform.ts` rejects anything else,
    // the caller swallows the error, and the app silently falls back to
    // `platform: "unsupported"` — where `hasPrimaryModifier` returns false for
    // every event and EVERY keyboard shortcut stops working, with nothing in the
    // console to say why.
    platform:
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "unsupported",
    homeDir: app.getPath("home"),
  }));
  ipcMain.handle(CHANNELS.resolvePaths, (_event, { cwd, paths }) => resolvePaths(cwd, paths));
  ipcMain.handle(CHANNELS.openEditor, (_event, { request }) =>
    // Destructured: the renderer wraps the payload in `{ request }` to match the
    // Rust parameter name, so taking the payload whole read `.editor` off the
    // wrapper and every file link failed as "editor not supported".
    openEditor(request),
  );
  // Never rejects: "no open workspace holds this file" is an ORDINARY answer —
  // it is how a click reaches the external app — so an unreadable root degrades
  // to null rather than turning a link into an error bar.
  ipcMain.handle(CHANNELS.workspaceForPath, (_event, { path: target, roots }) =>
    workspaceForPath({ path: target, roots: roots ?? [] }),
  );
  ipcMain.handle(CHANNELS.externalApps, () => listExternalApps());
  ipcMain.handle(
    CHANNELS.openInApp,
    (_event, { appId, path: target, isDirectory }) =>
      openInApp({ appId, path: target, isDirectory: isDirectory === true }),
  );
  ipcMain.handle(CHANNELS.listPromptAssets, (_event, { agent, cwd }) =>
    listPromptAssets(agent, cwd ?? null),
  );
  ipcMain.handle(CHANNELS.readImageAsDataUrl, (_event, { path: target }) =>
    readImageAsDataUrl(target),
  );
  ipcMain.handle(CHANNELS.scanWorkspaceFavicon, (_event, { dir }) => scanWorkspaceFavicon(dir));
  // Token usage: one command, no payload — the scan takes no renderer input.
  // Failures inside the scan are in-band (`sources[].state`, `skippedLines`);
  // a rejection here is user-safe while the detail stays in main's log.
  const usageService = createUsageService({
    home: app.getPath("home"),
    cachePath: path.join(app.getPath("userData"), USAGE_CACHE_FILE),
    reportCacheWriteFailure: (error) => {
      console.error("Deck: the usage cache could not be written:", error);
    },
  });
  ipcMain.handle(CHANNELS.usageSnapshot, async () => {
    try {
      return await usageService.snapshot();
    } catch (error) {
      console.error("Deck: the usage scan failed:", error);
      throw new Error("the usage scan failed", { cause: error });
    }
  });
  ipcMain.handle(CHANNELS.sessionsList, (_event, { limit }) =>
    listSessions(app.getPath("home"), typeof limit === "number" ? limit : undefined),
  );
  ipcMain.handle(CHANNELS.suspendMenuAccelerators, (event, { suspended }) => {
    deps.setRecording(event.sender.id, suspended === true);
  });
}
