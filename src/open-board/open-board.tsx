import { invoke } from "../host/bridge";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "../host/dialog-host";
import type { Preset } from "../lib/preset-schema";
import { partitionRecents, resolveAgent } from "../lib/workspace-recents";
import { workspaceLabel } from "../lib/workspace-label";
import type { AgentChoice, AgentResolution, RecentWorkspace } from "../lib/workspace-recents";
import { getDesktopEnvironment, hasPrimaryModifier } from "../lib/platform";
import type { DetectedAgent } from "../terminal/pty-client";
import { detectedAgents, ensureAgentsDetected } from "../terminal/agent-detection-store";
import {
  agentOptions,
  BUILTIN_AGENTS,
  probeNames,
  type AgentOption,
  type CustomAgent,
} from "../lib/agent-catalog";
import { settings } from "../settings/settings-store";
import { boardPresets, presetsData } from "../presets/presets-store";
import { removeWorkspaceRecents, workspacesData } from "./workspaces-store";
import type { SessionEntry } from "../lib/session-history";
import { formatShortcutBinding } from "../lib/shortcut-label";
import { OpenBoardHome, type StaleAgentNote } from "./open-board-home";
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
  /**
   * Open Settings, where the agent catalog is. Offered beside every launch the
   * board refuses to make silently — a remembered CLI that is gone is fixed
   * there and nowhere else. Settings covers the whole window above this board
   * (z-35 over z-30), so the board is still standing behind it on Back.
   */
  onManageAgents(): void;
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

/** A launch the board is holding back until the user says yes to it. */
interface PendingOpen {
  readonly path: string;
  readonly preset: Preset;
  /** What will actually run — never what the row remembered. */
  readonly agent: AgentChoice;
  readonly message: string;
}

/**
 * WHY a remembered agent cannot run. `agentOptions` drops the disabled and the
 * undetected alike, so the resolution itself cannot tell them apart — but the
 * two are fixed by different controls on the same Settings screen, and a
 * sentence that sends someone to install a CLI they already have is worse than
 * saying nothing. `null` = it can run.
 */
export type AgentUnavailability = "not-installed" | "disabled" | null;

/** Reason for `id`, read against what the probe found and what is switched on. */
export function unavailabilityOf(
  id: string,
  detected: readonly DetectedAgent[],
  customAgents: readonly CustomAgent[],
  disabledAgents: readonly string[],
): AgentUnavailability {
  if (agentOptions(detected, customAgents, disabledAgents).some((a) => a.id === id)) {
    return null;
  }
  // Same list with the Settings switch NOT applied: present here and absent
  // above means the binary is there and the user turned the agent off.
  return agentOptions(detected, customAgents, []).some((a) => a.id === id)
    ? "disabled"
    : "not-installed";
}

/** The row badge: short enough for the meta line, exact about which it is. */
export function unavailabilityBadge(reason: Exclude<AgentUnavailability, null>): string {
  return reason === "disabled" ? "Turned off" : "Not installed";
}

function unavailabilityClause(reason: Exclude<AgentUnavailability, null>): string {
  return reason === "disabled" ? "is switched off in Settings" : "is not installed";
}

/**
 * What the board says instead of quietly running the wrong agent.
 *
 * Both halves are stated: the agent that cannot run, and the one that would
 * take its place. Naming only the failure would leave the user pressing
 * `Open anyway` without knowing what they are agreeing to.
 */
export function substitutionMessage(
  resolution: AgentResolution,
  customAgents: readonly CustomAgent[],
  reason: Exclude<AgentUnavailability, null>,
): string | null {
  if (resolution.kind === "chosen") {
    return null;
  }
  const gone = resolution.wanted === null ? null : agentLabel(resolution.wanted, customAgents);
  if (resolution.kind === "substituted") {
    return `${gone} ${unavailabilityClause(reason)} — this workspace will open with ${agentLabel(
      resolution.agent,
      customAgents,
    )} instead.`;
  }
  return gone === null
    ? "No agent CLI was found — this workspace will open a plain shell."
    : `${gone} ${unavailabilityClause(reason)} — this workspace will open a plain shell.`;
}

export function OpenBoard({
  canCancel,
  canBrowseSessions,
  openWorkspacePaths,
  onCancel,
  onOpen,
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
  /**
   * A launch held back because the agent it would run is not the agent this
   * board just promised. The board's one click used to be the whole
   * interaction; when the answer differs from the row, one click is a lie, so
   * the decision gets a step of its own — stated, with `Open anyway` and the
   * one place the problem is fixable beside it.
   *
   * It is a payload, not a flag, because the pick has already been resolved
   * against the probe and the liveness pass: confirming re-runs neither, so a
   * discovery refresh landing between the question and the answer cannot swap
   * the agent out from under the sentence the user just read.
   */
  const pending = useSignal<PendingOpen | null>(null);
  /**
   * Whether discovery has answered at least once. What the rows READ is the
   * live `detectedAgents` signal — Settings' own Refresh writes it, and this
   * board is still mounted underneath Settings, so installing a CLI and coming
   * back updates the rows without a remount. This flag only gates the first
   * frame: an empty pre-boot list would otherwise mark every remembered agent
   * unavailable before anything had been probed.
   */
  const probed = useSignal(false);
  // Create-worktree form state (task 16), split into its own hook (F8).
  const worktreeForm = useWorktreeForm();
  const containerRef = useRef<HTMLDivElement>(null);
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
    let cancelled = false;
    void ensureAgentsDetected(probeNames(customAgents)).then(() => {
      if (!cancelled) {
        probed.value = true;
      }
    });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `probed` is a stable signal
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
    pending.value = null;
    view.value = "sessions";
  }

  /** Fresh state every time the form is opened — never a stale attempt. */
  function openWorktreeForm(): void {
    worktreeForm.reset();
    // The question is a home-view control and would survive out of sight
    // otherwise, ready to launch a workspace the user has moved on from.
    pending.value = null;
    notice.value = null;
    view.value = "worktree";
  }

  /** What may be launched right now, out of one discovery answer. */
  function launchable(list: readonly DetectedAgent[]): readonly AgentOption[] {
    return agentOptions(list, customAgents, settings.value.disabledAgents);
  }

  /** Why an id cannot run, against the CURRENT discovery answer. */
  function unavailability(id: string, list: readonly DetectedAgent[]): AgentUnavailability {
    return unavailabilityOf(id, list, customAgents, settings.value.disabledAgents);
  }

  /**
   * What a row says about a remembered agent it can no longer run, or null.
   * Silent until the probe has answered once: a row is never annotated on a
   * guess. The badge and its hover sentence come from the same reason, so the
   * row and the decision line can never disagree about which failure it is.
   */
  function staleAgent(recent: RecentWorkspace): StaleAgentNote | null {
    if (!probed.value || typeof recent.lastAgent !== "string") {
      return null;
    }
    const reason = unavailability(recent.lastAgent, detectedAgents.value);
    return reason === null
      ? null
      : {
          badge: unavailabilityBadge(reason),
          detail: `${agentLabel(recent.lastAgent, customAgents)} ${unavailabilityClause(reason)}`,
        };
  }

  /**
   * The board's one action: open `path` with the combo it was last opened
   * with. An unknown folder (picked or freshly created) has no memory, so it
   * takes the last-used preset and the first detected agent.
   *
   * A remembered agent whose binary has left `$PATH` — or which was switched
   * off in Settings — used to fall back SILENTLY here: the row printed
   * `Default · Claude Code` and the click opened whatever stood first on
   * `$PATH`, with a bare shell as the last resort. That is fixed by giving the
   * substitution its own step (`pending`) rather than by refusing: the folder
   * is still one more click away, and the click now says which agent it
   * starts. `Manage agents…` sits beside it because Settings is the only place
   * the memory can be made true again.
   */
  async function openWorkspace(path: string): Promise<void> {
    if (opening.value) {
      return;
    }
    // A new click replaces the question the last one asked — a stale `Open
    // anyway` must never be able to launch a workspace nobody is looking at.
    // Cleared FIRST, so the missing-folder return below cannot leave the two
    // messages on screen together, one of them about another workspace.
    pending.value = null;
    notice.value = null;
    if (missing.value.has(path)) {
      notice.value = `${workspaceLabel(path)} is missing — pick another folder`;
      return;
    }
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
    // Asked HERE rather than held from mount: a warm cache answers in the same
    // turn, a cold one is waited for (a click landing before discovery answers
    // would otherwise resolve against an empty list and quietly open a Shell),
    // and a list refreshed while the user was in Settings is the list this
    // decides from — which is the whole point of sending them there.
    const found = await ensureAgentsDetected(probeNames(customAgents));
    const resolution = resolveAgent(entry?.lastAgent, launchable(found));
    const message =
      resolution.kind === "chosen"
        ? null
        : substitutionMessage(
            resolution,
            customAgents,
            resolution.wanted === null
              ? "not-installed"
              : (unavailability(resolution.wanted, found) ?? "not-installed"),
          );
    if (message !== null) {
      opening.value = false;
      pending.value = { path, preset, agent: resolution.agent, message };
      // The question lives on home, and this open can be started from the
      // worktree form — where the answer would be asked behind a subview and
      // the launch would simply never happen.
      goHome();
      return;
    }
    opening.value = false;
    await launch(path, preset, resolution.agent);
  }

  /** The spawn itself, shared by a straight open and a confirmed one. */
  async function launch(path: string, preset: Preset, agent: AgentChoice): Promise<void> {
    opening.value = true;
    const ok = await onOpen(path, preset, agent);
    opening.value = false;
    if (!ok) {
      notice.value = "Couldn't start a shell here — check the folder and try again";
    }
  }

  /**
   * `Open anyway`: launch exactly the agent the held sentence named.
   *
   * The folder is re-checked rather than trusted: the question was raised
   * against a liveness pass that ran before it, and the recents effect keeps
   * refreshing `missing` underneath — a folder that went away while the
   * question stood must not be spawned into.
   */
  function confirmPending(): void {
    const held = pending.value;
    if (held === null || opening.value) {
      return;
    }
    pending.value = null;
    if (missing.value.has(held.path)) {
      notice.value = `${workspaceLabel(held.path)} is missing — pick another folder`;
      return;
    }
    void launch(held.path, held.preset, held.agent);
  }

  /**
   * `Manage agents…`: Settings paints over this board and Back returns to it,
   * so the question is dropped rather than kept — the answer it was built from
   * is exactly what the user went to change.
   */
  function manageAgents(): void {
    pending.value = null;
    notice.value = null;
    onManageAgents();
  }

  function removeRecentRows(paths: readonly string[]): void {
    if (paths.length === 0) {
      return;
    }
    // A question about a row the user just deleted has nothing left to name.
    if (pending.value !== null && paths.includes(pending.value.path)) {
      pending.value = null;
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
    pending.value = null;
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

  /** The combo line a recents row shows — the one place the remembered
   *  layout/agent is stated now that opening is a single click with no
   *  preview between it and the spawn. It reports the MEMORY; whether that
   *  memory can still run is `staleAgent`'s answer, printed beside it. */
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
          decision={pending.value === null ? null : pending.value.message}
          describeCombo={describeCombo}
          staleAgent={staleAgent}
          onConfirmOpen={confirmPending}
          onManageAgents={manageAgents}
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
