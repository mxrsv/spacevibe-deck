import { invoke } from "../host/bridge";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "../host/dialog-host";
import {
  agentForWorkspace,
  partitionRecents,
  type RecentWorkspace,
} from "../lib/workspace-recents";
import { workspaceLabel } from "../lib/workspace-label";
import { getDesktopEnvironment, hasPrimaryModifier } from "../lib/platform";
import type { DetectedAgent } from "../terminal/pty-client";
import {
  agentsProbed,
  detectedAgents,
  ensureAgentsDetected,
} from "../terminal/agent-detection-store";
import { agentOptions, BUILTIN_AGENTS, probeNames, type CustomAgent } from "../lib/agent-catalog";
import { settings } from "../settings/settings-store";
import { removeWorkspaceRecents, workspacesData } from "./workspaces-store";
import type { SessionEntry } from "../lib/session-history";
import { formatShortcutBinding } from "../lib/shortcut-label";
import { BoardComposer } from "./board-composer";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { OpenBoardWorktreeForm } from "./open-board-worktree-form";
import { available as worktreeHostAvailable } from "../host/worktree-host";
import {
  available as workspaceCreateAvailable,
  createWorkspace,
} from "../host/workspace-create-host";
import { newTaskDraft, prefillWorkspace, updateDraft } from "../launcher/launcher-store";
import { openAgentProblem, startTaskProblem, type NewTaskDraft } from "../launcher/new-task-draft";
import type { LaunchTaskOutcome } from "../terminal/task-prompt-send";
import type { LauncherPending } from "../launcher/launcher-fields";
import { useWorktreeForm } from "./use-worktree-form";
import { SessionsBody } from "../ui/sessions/sessions-body";

export interface OpenBoardProps {
  canCancel: boolean;
  /** Session history is Electron-only; false omits the board entry entirely. */
  canBrowseSessions: boolean;
  /** Workspace paths currently represented by live tabs. */
  readonly openWorkspacePaths: ReadonlySet<string>;
  /**
   * The workspace the board opens ON when the draft names none (spec §5): the
   * active tab's, or null at cold start, where the newest live recent answers
   * instead.
   */
  readonly contextWorkspacePath: string | null;
  onCancel(): void;
  /**
   * Start the drafted task. The board never resolves a workspace or an agent
   * itself any more — the draft is the whole request, and `App` composes the
   * command and calls `launchTask`.
   */
  onStartTask(draft: NewTaskDraft): Promise<LaunchTaskOutcome>;
  /** Open the drafted agent with no prompt sent. */
  onOpenAgent(draft: NewTaskDraft): Promise<LaunchTaskOutcome>;
  /** Resolves false when the history entry could not materialize. */
  onResumeSession(entry: SessionEntry): Promise<boolean>;
  /** Open Settings, for a draft whose agent cannot run (design §7). */
  onManageAgents(): void;
}

/**
 * Home composes a task. Workspace and worktree are destination-creation
 * subviews that return to that same draft without starting a process.
 */
type BoardView = "home" | "sessions" | "workspace" | "worktree";

function agentLabel(id: string, customAgents: readonly CustomAgent[]): string {
  const builtin = BUILTIN_AGENTS.find((agent) => agent.id === id);
  if (builtin !== undefined) {
    return builtin.label;
  }
  return customAgents.find((agent) => agent.id === id)?.label ?? id;
}

/**
 * What the board says after a launch attempt. `sent` and `started` say nothing
 * — the board is about to be dismissed, and a message on a surface that is
 * leaving is a flash the user cannot read.
 *
 * `prompt-pending` is the NORMAL result while `TASK_PROMPT_AUTOSEND` is off
 * (the first-run trust-menu measurement), so it reads as delivery rather than
 * as a failure.
 */
export function launchNotice(outcome: LaunchTaskOutcome): string | null {
  switch (outcome) {
    case "sent":
    case "started":
      return null;
    case "prompt-pending":
      return "Your task is waiting in the agent — press Enter there to send it";
    case "prompt-not-sent":
      return "The agent did not become ready — your task is still here";
    case "prompt-failed":
      return "Couldn't hand the task to the agent — the pane is open, try pasting it";
    case "spawn-failed":
      return "Couldn't start a session here — check the folder and try again";
  }
}

export function OpenBoard({
  canCancel,
  canBrowseSessions,
  openWorkspacePaths,
  contextWorkspacePath,
  onCancel,
  onStartTask,
  onOpenAgent,
  onResumeSession,
  onManageAgents,
}: OpenBoardProps) {
  const platform = getDesktopEnvironment().platform;
  const openFolderShortcut = formatShortcutBinding(
    platform === "windows"
      ? { key: "o", ctrl: true, shift: true, action: "new-tab" }
      : { key: "o", meta: true, action: "new-tab" },
    platform,
  );
  const recents = workspacesData.value.recents;
  const home = getDesktopEnvironment().homeDir;
  const view = useSignal<BoardView>("home");
  const missing = useSignal<ReadonlySet<string>>(new Set());
  const opening = useSignal(false);
  /** Which launcher operation is in flight, or null. */
  const pending = useSignal<LauncherPending | null>(null);
  /**
   * The one thing the board says when an open does not happen. There is no
   * footer to hold a preview any more, so this line is the ONLY place a
   * failed spawn or a missing folder is ever said: the manager writes its
   * error into a terminal that is behind this overlay, and on a first run
   * there is no terminal to write to at all. Cleared by the next attempt.
   */
  const notice = useSignal<string | null>(null);
  // Create-worktree form state (task 16), split into its own hook (F8).
  const worktreeForm = useWorktreeForm();
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * The agent list this board resolves against, as a promise rather than a
   * value. One click now opens, so a click landing before discovery answers
   * would otherwise resolve a remembered agent against an EMPTY list and
   * quietly open a Shell pane instead — `resolveAgentChoice` falls back rather
   * than waiting. The open path awaits this instead of reading a signal that
   * may not be filled yet.
   *
   * Since the cache landed (`agent-detection-store.ts`) this is normally
   * already resolved: the boot probe answered long before the board opened, and
   * only a first launch — or a set of declared agents nothing has probed yet —
   * makes the await do any waiting.
   */
  const probe = useRef<Promise<readonly DetectedAgent[]> | null>(null);
  /**
   * The in-flight `dirs_exist` pass, for the same reason `probe` is held: the
   * open path must not decide a folder is alive just because the answer has
   * not arrived. Resolves to the set of missing paths, or `null` when the
   * probe itself failed and liveness is simply unknown.
   */
  const livenessProbe = useRef<Promise<ReadonlySet<string> | null> | null>(null);
  /** Whether this open has already answered the Workspace field for the user. */
  const prefilled = useRef(false);
  const customAgents = settings.value.customAgents;
  const draft = newTaskDraft.value;
  /** Every declared agent, so a missing one can still be SHOWN and explained. */
  const agents = agentOptions(detectedAgents.value, customAgents, settings.value.disabledAgents);
  const draftContext = {
    runnableAgentIds: agents.filter((agent) => !agent.missing).map((agent) => agent.id),
    unavailableAgentIds: agents.filter((agent) => agent.missing).map((agent) => agent.id),
  };
  const problem = startTaskProblem(draft, draftContext);
  /** The same chain without the prompt — what `Open agent first` answers to. */
  const openProblem = openAgentProblem(draft, draftContext);

  /**
   * The caret starts in the prompt, not on the shell (DL-32.1: the composer is
   * the focal artifact). Focusing the container asked "describe the outcome"
   * and then dropped every keystroke — Quick Launch has always focused its
   * textarea, and the two surfaces share a draft, so they must not differ here.
   * The board's own keydown handler still sees Escape and the folder chord:
   * it is on the container and events bubble to it.
   */
  function focusComposer(): void {
    const root = containerRef.current;
    if (root === null) {
      return;
    }
    (root.querySelector<HTMLTextAreaElement>("textarea") ?? root).focus();
  }

  /* oxlint-disable react-hooks/exhaustive-deps -- mount only; the composer is in the same commit */
  useEffect(() => {
    focusComposer();
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  // Refreshes whenever the declared set changes: adding an agent in Settings
  // and coming straight back to the board has to see it without a relaunch —
  // which the cache keys on, so a changed set is awaited rather than served
  // stale. Never rejects (the store degrades to the best list it knows), so the
  // board still falls back to Shell only when discovery cannot answer at all.
  useEffect(() => {
    probe.current = ensureAgentsDetected(probeNames(customAgents));
  }, [customAgents]);

  /* oxlint-disable react-hooks/exhaustive-deps -- re-runs on recents only; the missing-signal read is a snapshot */
  useEffect(() => {
    const paths = recents.map((recent) => recent.path);
    if (paths.length === 0) {
      // Removing the last rows must also clear the stale flags — a path left
      // in `missing` would keep blocking Open for a folder picked again after
      // being recreated on disk.
      missing.value = new Set();
      // Drop the previous pass with them, or a folder picked fresh would be
      // judged against an answer about rows that no longer exist.
      livenessProbe.current = null;
      return;
    }
    let cancelled = false;
    // Held the same way the agent probe is, and for the same reason: one click
    // now opens. A click landing before this answers would read an EMPTY
    // `missing` set, walk past the guard, and hand a deleted folder to the
    // spawn — where `resolveSpawnCwd` silently falls back to $HOME and the
    // user gets a shell in their home directory under a project's name, with
    // the dead path written back into recents. The board's one notice never
    // fires there, because as far as the app is concerned the open SUCCEEDED.
    livenessProbe.current = invoke<boolean[]>("dirs_exist", { paths })
      .then((flags) => {
        const gone = new Set(paths.filter((_, index) => !flags[index]));
        if (!cancelled) {
          missing.value = gone;
        }
        return gone;
      })
      .catch((err: unknown) => {
        console.warn("dirs_exist failed:", err);
        // An unanswerable probe must not read as "every folder is fine".
        return null;
      });
    return () => {
      cancelled = true;
    };
  }, [recents]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  /**
   * The board opens ON a workspace (spec §5), with that workspace's agent
   * already chosen (spec §7) — the active tab's workspace, else the newest
   * recent that still exists on disk.
   *
   * Three things make this safe to do behind the user's back:
   *
   * - it writes ONLY into an empty field. A draft carried in from Quick Launch
   *   or left from an abandoned attempt already names a workspace, and spec
   *   §4.1 forbids overwriting an explicit choice;
   * - it waits for the SAME liveness pass a click waits for, so a folder that
   *   has been deleted is never quietly handed to a launch — that is the whole
   *   reason `livenessProbe` is held as a promise;
   * - it says nothing on failure. No candidate, or every candidate gone, and
   *   the board simply opens the way it did before. `notice` is reserved for
   *   what the user asked for, and nobody asked for this.
   *
   * Keyed on `recents` rather than on mount because the workspace store
   * hydrates asynchronously: a cold start can paint the board before its own
   * history has arrived. `prefilled` is what keeps it to once per open.
   */
  /* oxlint-disable react-hooks/exhaustive-deps -- re-runs on recents; every other read is a snapshot */
  useEffect(() => {
    if (prefilled.current || newTaskDraft.value.workspacePath !== null) {
      return;
    }
    if (contextWorkspacePath === null && recents.length === 0) {
      return; // nothing to open on yet — a later hydration may bring one
    }
    prefilled.current = true;
    let cancelled = false;
    void (async () => {
      const gone = await livenessProbe.current;
      // A tab is already RUNNING in the contextual workspace, so its liveness
      // is not in question; only the remembered rows have to be checked.
      const candidate =
        contextWorkspacePath ??
        recents.find((recent) => gone?.has(recent.path) !== true)?.path ??
        null;
      if (candidate === null) {
        return;
      }
      const seed = await seedAgentFor(candidate);
      // The awaits above are long enough for a click to land first, and the
      // user's own selection outranks this one every time.
      if (cancelled || newTaskDraft.value.workspacePath !== null) {
        return;
      }
      prefillWorkspace(candidate, seed);
    })();
    return () => {
      cancelled = true;
    };
  }, [recents, contextWorkspacePath]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  const groups = partitionRecents(recents, missing.value);

  function goHome(): void {
    view.value = "home";
    queueMicrotask(() => focusComposer());
  }

  function openSessions(): void {
    notice.value = null;
    view.value = "sessions";
  }

  function openWorkspaceForm(): void {
    notice.value = null;
    view.value = "workspace";
  }

  async function pickWorkspaceParent(): Promise<string | null> {
    return open({ directory: true, multiple: false });
  }

  /** Fresh state every time the form is opened — never a stale attempt. */
  function openWorktreeForm(): void {
    worktreeForm.reset();
    view.value = "worktree";
  }

  /**
   * A recents row, a picked folder, a freshly created worktree: all of them
   * SELECT. Nothing here starts a process any more — that reverses the
   * 2026-08-16 one-click-opens contract on purpose (design §4.1), because a
   * workspace choice carrying the side effect of spawning an agent is the
   * thing this design set out to fix.
   *
   * The liveness pass is kept exactly as it was. A dead folder must still be
   * refused HERE, before it can reach the composer: a draft carrying a path
   * that cannot spawn would only fail later, at the launch, where the board
   * has nothing useful left to say about it.
   *
   * Selecting also seeds the agent (design §7): the workspace's remembered
   * agent when it is still runnable, else the first runnable one. Unlike the
   * old flow that substitution is now VISIBLE before anything is pressed,
   * which is what the removed config view could not offer.
   */
  async function selectWorkspace(path: string): Promise<void> {
    if (opening.value) {
      return;
    }
    if (missing.value.has(path)) {
      notice.value = `${workspaceLabel(path)} is missing — pick another folder`;
      return;
    }
    notice.value = null;
    opening.value = true;
    // `null` means the probe failed, so nothing is known and the selection
    // goes ahead — refusing on an unanswerable probe would strand the board.
    const gone = await livenessProbe.current;
    opening.value = false;
    if (gone?.has(path) === true) {
      notice.value = `${workspaceLabel(path)} is missing — pick another folder`;
      return;
    }
    prefillWorkspace(path, await seedAgentFor(path));
  }

  /**
   * The agent a workspace should arrive with (spec §7): its remembered one
   * while that is still runnable, else the starred default, else the first
   * runnable agent. Awaits the probe for the reason `probe` is held at all —
   * resolving against an empty list would seed nothing and leave the field
   * blank on a machine that has agents.
   */
  async function seedAgentFor(path: string): Promise<string | null> {
    const detected = (await probe.current) ?? [];
    const runnable = agentOptions(detected, customAgents, settings.value.disabledAgents).filter(
      (option) => !option.missing,
    );
    const runs = (id: string | null | undefined): boolean =>
      typeof id === "string" && runnable.some((option) => option.id === id);
    const remembered = agentForWorkspace(recents, path, runnable);
    if (runs(remembered)) {
      return remembered as string;
    }
    // The STARRED default is checked against the probe like everything else:
    // spec §7 says an unavailable choice falls to the first runnable agent, and
    // seeding one that is not on `$PATH` would open the board on a red
    // "not on your PATH" — the resting alarm this change exists to remove.
    const starred = settings.value.defaultAgent;
    return runs(starred) ? (starred as string) : (runnable[0]?.id ?? null);
  }

  function removeRecentRows(paths: readonly string[]): void {
    if (paths.length === 0) {
      return;
    }
    removeWorkspaceRecents(paths);
  }

  async function pickFolder(): Promise<void> {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        await selectWorkspace(picked);
      }
    } catch (err: unknown) {
      console.warn("Folder picker failed:", err);
      notice.value = "Couldn't open the folder picker — try again";
    }
  }

  async function resumePastSession(entry: SessionEntry): Promise<void> {
    if (opening.value) {
      return;
    }
    notice.value = null;
    opening.value = true;
    const resumed = await onResumeSession(entry);
    opening.value = false;
    if (!resumed) {
      notice.value = "Couldn't resume that session — try another one";
    }
  }

  /**
   * A freshly created worktree is SELECTED and the board returns home with the
   * prompt and agent intact (design §6). It used to open straight through;
   * creating a destination is no longer the same act as starting work in it.
   */
  function submitWorktree(): void {
    void worktreeForm.submit((path) => {
      void selectWorkspace(path).then(goHome);
    });
  }

  /** The agent a row was last opened with — the row's one line of memory. */
  function describeCombo(recent: RecentWorkspace): string {
    if (typeof recent.lastAgent === "string") {
      return agentLabel(recent.lastAgent, customAgents);
    }
    return recent.lastAgent === null ? "Shell" : "";
  }

  /**
   * The launch half. `App` owns composing the command and calling
   * `launchTask`; the board owns saying what happened, because it is the only
   * surface on screen at cold start — the manager writes its own errors into a
   * terminal that may not exist yet.
   *
   * A successful outcome closes nothing here: `App` clears the draft and
   * dismisses the board, so a board that stays up always means something is
   * still to be done.
   */
  async function runLaunch(kind: "start" | "open"): Promise<void> {
    if (pending.value !== null) {
      return;
    }
    notice.value = null;
    pending.value = kind === "start" ? "sending-prompt" : "opening-agent";
    const outcome = await (kind === "start" ? onStartTask(draft) : onOpenAgent(draft));
    pending.value = null;
    notice.value = launchNotice(outcome);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) {
      return; // the worktree form's fields own their keys
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    // ⌘O / Ctrl+Shift+O work from either view — picking a folder is the
    // board's other way in, and now it opens straight through.
    if (
      key === "o" &&
      hasPrimaryModifier(event) &&
      (getDesktopEnvironment().platform !== "windows" || event.shiftKey)
    ) {
      void pickFolder();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (key === "Escape") {
      if (view.value !== "home") {
        // Subviews back out before Escape reaches the board's own cancel.
        goHome();
      } else if (canCancel) {
        onCancel();
      }
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div class="open-board" tabIndex={0} onKeyDown={handleKeyDown} ref={containerRef}>
      {view.value === "workspace" ? (
        <main class="nt-board">
          <div class="nt-board__content nt-board__content--subview">
            <CreateWorkspaceForm
              initialParent={home}
              onPickParent={pickWorkspaceParent}
              create={createWorkspace}
              onCreated={(path) => {
                void selectWorkspace(path).then(goHome);
              }}
              onBack={goHome}
            />
          </div>
        </main>
      ) : view.value === "worktree" ? (
        <OpenBoardWorktreeForm
          recents={recents}
          homeDir={home}
          repoPath={worktreeForm.state.repoPath}
          branch={worktreeForm.state.branch}
          destPath={worktreeForm.state.destPath}
          error={worktreeForm.state.error}
          creating={worktreeForm.state.creating}
          onRepoChange={worktreeForm.setRepo}
          onBrowseRepo={() => void worktreeForm.browseRepo()}
          onBranchChange={worktreeForm.setBranch}
          onDestChange={worktreeForm.setDest}
          onBack={goHome}
          onSubmit={submitWorktree}
        />
      ) : view.value === "sessions" ? (
        <div class="board-sessions">
          <div class="board-sessions__head">
            <button type="button" class="board-back" onClick={goHome}>
              Back
            </button>
            <h1>Resume a session</h1>
          </div>
          {notice.value !== null ? (
            <p class="board-home__notice" role="status">
              {notice.value}
            </p>
          ) : null}
          <SessionsBody variant="dock" onResume={(entry) => void resumePastSession(entry)} />
        </div>
      ) : (
        <BoardComposer
          homeDir={home}
          openFolderShortcut={openFolderShortcut}
          canCreateWorkspace={workspaceCreateAvailable}
          canCreateWorktree={worktreeHostAvailable}
          canBrowseSessions={canBrowseSessions}
          alive={groups.alive}
          missingGroup={groups.missing}
          openWorkspacePaths={openWorkspacePaths}
          draft={draft}
          agents={agents}
          declaredModels={settings.value.agentModels}
          agentRuntimeDefaults={settings.value.agentRuntimeDefaults}
          pending={pending.value}
          problem={problem}
          openProblem={openProblem}
          agentsResolved={agentsProbed.value}
          notice={notice.value}
          describeCombo={describeCombo}
          onDraftChange={updateDraft}
          onSelectWorkspace={(path) => void selectWorkspace(path)}
          onPickFolder={() => void pickFolder()}
          onCreateWorkspace={openWorkspaceForm}
          onCreateWorktree={openWorktreeForm}
          onManageAgents={onManageAgents}
          onBrowseSessions={openSessions}
          onStartTask={() => void runLaunch("start")}
          onOpenAgent={() => void runLaunch("open")}
          onRemove={removeRecentRows}
        />
      )}
    </div>
  );
}
