import { invoke } from "../host/bridge";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "../host/dialog-host";
import type { Preset } from "../lib/preset-schema";
import { partitionRecents, resolveAgentChoice } from "../lib/workspace-recents";
import { workspaceLabel } from "../lib/workspace-label";
import type { AgentChoice, RecentWorkspace } from "../lib/workspace-recents";
import { getDesktopEnvironment, hasPrimaryModifier } from "../lib/platform";
import type { DetectedAgent } from "../terminal/pty-client";
import { ensureAgentsDetected } from "../terminal/agent-detection-store";
import { agentOptions, BUILTIN_AGENTS, probeNames, type CustomAgent } from "../lib/agent-catalog";
import { settings } from "../settings/settings-store";
import { boardPresets, presetsData } from "../presets/presets-store";
import { removeWorkspaceRecents, workspacesData } from "./workspaces-store";
import type { SessionEntry } from "../lib/session-history";
import { formatShortcutBinding } from "../lib/shortcut-label";
import { OpenBoardHome } from "./open-board-home";
import { OpenBoardWorktreeForm } from "./open-board-worktree-form";
import { available as worktreeHostAvailable } from "../host/worktree-host";
import { useWorktreeForm } from "./use-worktree-form";
import { SessionsBody } from "../ui/sessions/sessions-body";

export interface OpenBoardProps {
  canCancel: boolean;
  /** Session history is Electron-only; false omits the board entry entirely. */
  canBrowseSessions: boolean;
  /** Workspace paths currently represented by live tabs. */
  readonly openWorkspacePaths: ReadonlySet<string>;
  onCancel(): void;
  /** Resolves to false on failure (e.g. PTY spawn error) — board stays up. */
  onOpen(workspace: string, preset: Preset, agent: AgentChoice): Promise<boolean>;
  /** Resolves false when the history entry could not materialize. */
  onResumeSession(entry: SessionEntry): Promise<boolean>;
}

/**
 * Home: pick a workspace and it opens, with the combo that workspace was last
 * opened with. Worktree: task 16's create-worktree form, reached from home.
 *
 * Contract 2026-08-16: the Layout + Agent config view is GONE. Picking is the
 * whole interaction — one click opens — and changing the agent is
 * `AgentQuickPicker`'s job (⌘T), which is where a per-open choice lives now.
 */
type BoardView = "home" | "sessions" | "worktree";

function agentLabel(id: string, customAgents: readonly CustomAgent[]): string {
  const builtin = BUILTIN_AGENTS.find((agent) => agent.id === id);
  if (builtin !== undefined) {
    return builtin.label;
  }
  return customAgents.find((agent) => agent.id === id)?.label ?? id;
}

export function OpenBoard({
  canCancel,
  canBrowseSessions,
  openWorkspacePaths,
  onCancel,
  onOpen,
  onResumeSession,
}: OpenBoardProps) {
  const platform = getDesktopEnvironment().platform;
  const openFolderShortcut = formatShortcutBinding(
    platform === "windows"
      ? { key: "o", ctrl: true, shift: true, action: "new-tab" }
      : { key: "o", meta: true, action: "new-tab" },
    platform,
  );
  const recents = workspacesData.value.recents;
  const presets = boardPresets();
  const home = getDesktopEnvironment().homeDir;
  const view = useSignal<BoardView>("home");
  const missing = useSignal<ReadonlySet<string>>(new Set());
  const opening = useSignal(false);
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
  const customAgents = settings.value.customAgents;

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

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

  const groups = partitionRecents(recents, missing.value);

  function goHome(): void {
    view.value = "home";
    queueMicrotask(() => containerRef.current?.focus());
  }

  function openSessions(): void {
    notice.value = null;
    view.value = "sessions";
  }

  /** Fresh state every time the form is opened — never a stale attempt. */
  function openWorktreeForm(): void {
    worktreeForm.reset();
    view.value = "worktree";
  }

  /**
   * The board's one action: open `path` with the combo it was last opened
   * with. An unknown folder (picked or freshly created) has no memory, so it
   * takes the last-used preset and the first detected agent.
   *
   * A remembered agent whose binary has left $PATH falls back SILENTLY here —
   * `resolveAgentChoice` picks the first detected one and the pane still
   * opens. The config view used to warn about that in its footer; without a
   * step between the click and the spawn there is nowhere to warn before the
   * fact, and stopping the open to say it would be worse than opening.
   */
  async function openWorkspace(path: string): Promise<void> {
    if (opening.value) {
      return;
    }
    if (missing.value.has(path)) {
      notice.value = `${workspaceLabel(path)} is missing — pick another folder`;
      return;
    }
    notice.value = null;
    opening.value = true;
    // Wait for the liveness pass the same way the agent probe is waited for.
    // `null` means the probe failed, so nothing is known and the open goes
    // ahead — refusing on an unanswerable probe would strand the board.
    const gone = await livenessProbe.current;
    if (gone?.has(path) === true) {
      opening.value = false;
      notice.value = `${workspaceLabel(path)} is missing — pick another folder`;
      return;
    }
    const entry = recents.find((recent) => recent.path === path);
    const preset =
      presets.find((p) => p.id === entry?.lastPresetId) ??
      presets.find((p) => p.id === presetsData.value.lastUsedId) ??
      presets[0];
    // `lastAgent` carries all three cases on purpose: a string is a named
    // agent, `null` is a remembered Shell-only open, and `undefined` (never
    // opened, or opened before the field existed) means first detected.
    const detected = (await probe.current) ?? [];
    const agent = resolveAgentChoice(
      entry?.lastAgent,
      agentOptions(detected, customAgents, settings.value.disabledAgents),
    );
    const ok = await onOpen(path, preset, agent);
    opening.value = false;
    if (!ok) {
      notice.value = "Couldn't start a shell here — check the folder and try again";
    }
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
        await openWorkspace(picked);
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

  /** A freshly created worktree is never in `missing`, so it opens like any
   *  other workspace — straight through, no step in between. */
  function submitWorktree(): void {
    void worktreeForm.submit((path) => {
      void openWorkspace(path);
    });
  }

  /** The combo line a recents row's title attribute shows on hover — the one
   *  place the remembered layout/agent is stated now that opening is a
   *  single click with no preview between it and the spawn. */
  function describeCombo(recent: RecentWorkspace): string {
    const preset = presets.find((p) => p.id === recent.lastPresetId);
    return [
      preset?.name ?? null,
      typeof recent.lastAgent === "string"
        ? agentLabel(recent.lastAgent, customAgents)
        : recent.lastAgent === null
          ? "Shell"
          : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
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
      {view.value === "worktree" ? (
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
        <OpenBoardHome
          homeDir={home}
          openFolderShortcut={openFolderShortcut}
          canCreateWorktree={worktreeHostAvailable}
          canBrowseSessions={canBrowseSessions}
          alive={groups.alive}
          missingGroup={groups.missing}
          openWorkspacePaths={openWorkspacePaths}
          opening={opening.value}
          notice={notice.value}
          describeCombo={describeCombo}
          onPickFolder={() => void pickFolder()}
          onCreateWorktree={openWorktreeForm}
          onBrowseSessions={openSessions}
          onOpen={(path) => void openWorkspace(path)}
          onRemove={removeRecentRows}
        />
      )}
    </div>
  );
}
