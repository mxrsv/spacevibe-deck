import { ArrowLeft } from "lucide-preact";
import { invoke } from "../host/bridge";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "../host/dialog-host";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { isBuiltIn, type Preset } from "../lib/preset-schema";
import {
  folderName,
  partitionRecents,
  resolveAgentChoice,
} from "../lib/workspace-recents";
import type { AgentChoice, RecentWorkspace } from "../lib/workspace-recents";
import { tildify } from "../lib/process-info";
import { getDesktopEnvironment, hasPrimaryModifier } from "../lib/platform";
import { defaultPtyClient, type DetectedAgent } from "../terminal/pty-client";
import {
  agentOptions,
  BUILTIN_AGENTS,
  probeNames,
  type AgentOption,
  type CustomAgent,
} from "../lib/agent-catalog";
import { letterAvatar } from "../lib/letter-avatar";
import { settings } from "../settings/settings-store";
import {
  boardPresets,
  deletePreset,
  presetsData,
  renamePreset,
} from "../presets/presets-store";
import { removeWorkspaceRecents, workspacesData } from "./workspaces-store";
import { AGENT_LOGOS } from "../lib/agent-logos";
import { formatShortcutBinding } from "../lib/shortcut-label";
import { OpenBoardHome } from "./open-board-home";
import { OpenBoardLayoutSection } from "./open-board-layout-section";
import { OpenBoardWorktreeForm } from "./open-board-worktree-form";
import { available as worktreeHostAvailable } from "../host/worktree-host";
import { useWorktreeForm } from "./use-worktree-form";

export interface OpenBoardProps {
  canCancel: boolean;
  onCancel(): void;
  /** Resolves to false on failure (e.g. PTY spawn error) — board stays up. */
  onOpen(
    workspace: string,
    preset: Preset,
    agent: AgentChoice,
  ): Promise<boolean>;
  onNewPreset(workspace: string | null): void;
}

/**
 * Home: pick a workspace. Config: the Layout + Agent + Open combo for it.
 * Worktree: task 16's create-worktree form, reached from home only.
 */
type BoardView = "home" | "config" | "worktree";
type BoardSection = "layout" | "agent";

function agentLabel(id: string, customAgents: readonly CustomAgent[]): string {
  const builtin = BUILTIN_AGENTS.find((agent) => agent.id === id);
  if (builtin !== undefined) {
    return builtin.label;
  }
  return customAgents.find((agent) => agent.id === id)?.label ?? id;
}

/** `agentOptions` decides membership and order; the board only adds the logo. */
function buildAgentChips(
  detected: readonly DetectedAgent[],
  customAgents: readonly CustomAgent[],
): readonly (AgentOption & { readonly logo?: string })[] {
  return agentOptions(detected, customAgents).map((option) => ({
    ...option,
    logo: AGENT_LOGOS[option.id],
  }));
}

export function OpenBoard({
  canCancel,
  onCancel,
  onOpen,
  onNewPreset,
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
  // Home ⟺ nothing picked (contract 2026-08-14): the board opens on the
  // home view with no workspace selected, whatever Recents holds.
  const view = useSignal<BoardView>("home");
  const selectedPath = useSignal<string | null>(null);
  const selectedPresetId = useSignal<string>(
    presetsData.value.lastUsedId ?? presets[0].id,
  );
  // Raw selected choice this session; the *effective* agent is this resolved
  // against detected agents, so a late detect() or a stale memory can't launch
  // something that is not on $PATH. `undefined` = no explicit pick, which
  // resolves to the first detected agent; a remembered Shell (`null`) is
  // deliberately not preloaded — Shell is only ever an explicit click.
  const selectedAgent = useSignal<AgentChoice | undefined>(undefined);
  const agents = useSignal<readonly DetectedAgent[]>([]);
  const customAgents = settings.value.customAgents;
  const section = useSignal<BoardSection>("layout");
  const missing = useSignal<ReadonlySet<string>>(new Set());
  const renamingId = useSignal<string | null>(null);
  const renameValue = useSignal("");
  const confirmDeleteId = useSignal<string | null>(null);
  const opening = useSignal(false);
  // A failed Open, tagged with the exact combo that failed. Tagging (rather
  // than clearing from every selection handler) makes the notice self-expire:
  // change the folder, layout or agent and it stops matching, so the footer
  // goes back to the preview instead of showing an error about a combo the
  // user has already moved on from.
  const failure = useSignal<{
    path: string;
    presetId: string;
    agent: AgentChoice;
    message: string;
  } | null>(null);
  // Create-worktree form state (task 16), split into its own hook (F8).
  const worktreeForm = useWorktreeForm();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Re-probes whenever the declared set changes: adding an agent in Settings
  // and coming straight back to the board has to show it without a relaunch.
  useEffect(() => {
    let cancelled = false;
    defaultPtyClient
      .detectAgents(probeNames(customAgents))
      .then((found) => {
        if (!cancelled) {
          agents.value = found;
        }
      })
      .catch((err: unknown) => {
        console.warn("detect_agents failed:", err);
        if (!cancelled) {
          agents.value = []; // board degrades to Shell only
        }
      });
    return () => {
      cancelled = true;
    };
  }, [customAgents]);

  useEffect(() => {
    const paths = recents.map((recent) => recent.path);
    if (paths.length === 0) {
      // Removing the last rows must also clear the stale flags — a path left
      // in `missing` would keep blocking Open for a folder picked again after
      // being recreated on disk.
      missing.value = new Set();
      return;
    }
    let cancelled = false;
    invoke<boolean[]>("dirs_exist", { paths })
      .then((flags) => {
        if (!cancelled) {
          missing.value = new Set(paths.filter((_, index) => !flags[index]));
        }
      })
      .catch((err: unknown) => console.warn("dirs_exist failed:", err));
    return () => {
      cancelled = true;
    };
  }, [recents]);

  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId.value) ??
    presets[0];
  const chips = buildAgentChips(agents.value, customAgents);
  const effectiveAgent = resolveAgentChoice(selectedAgent.value, chips);
  const pickedPath = selectedPath.value;
  const workspaceValid = pickedPath !== null && !missing.value.has(pickedPath);
  const groups = partitionRecents(recents, missing.value);

  // The pending agent choice (usually a row's remembered one) may point at a
  // CLI no longer on $PATH — resolveAgentChoice silently falls back, so the
  // footer must warn before the user opens with something they did not pick
  // (parity with the old per-row is-stale marker). Quiet when detect found
  // nothing at all: the whole board already degrades to Shell only (FR-025).
  const pendingAgent = selectedAgent.value;
  const staleAgent =
    typeof pendingAgent === "string" &&
    chips.length > 0 &&
    !chips.some((chip) => chip.id === pendingAgent)
      ? pendingAgent
      : null;
  // A declared agent whose binary is gone stays selectable, so the warning
  // moves to the footer rather than the chip disappearing from the row.
  const missingAgent =
    typeof effectiveAgent === "string" &&
    chips.some((chip) => chip.id === effectiveAgent && chip.missing)
      ? effectiveAgent
      : null;

  /**
   * What the footer says instead of the "Open X as Y with Z" preview, and
   * whether it is a warning. Only two of the three states are: a first run
   * with nothing picked yet is a neutral prompt — nothing has gone wrong, the
   * user simply has not chosen — so it must not wear the same warning color
   * as a missing folder or a failed spawn, or the color stops meaning
   * anything (DL-3.2).
   */
  const failed = failure.value;
  const notice: { readonly text: string; readonly warn: boolean } | null =
    failed !== null &&
    failed.path === pickedPath &&
    failed.presetId === selectedPreset.id &&
    failed.agent === effectiveAgent
      ? { text: failed.message, warn: true }
      : pickedPath === null
        ? { text: "Select a workspace folder", warn: false }
        : !workspaceValid
          ? {
              text: `${folderName(pickedPath)} is missing — pick another folder`,
              warn: true,
            }
          : staleAgent !== null
            ? {
                text: `${agentLabel(staleAgent, customAgents)} isn't installed — opens with ${
                  effectiveAgent === null
                    ? "Shell"
                    : agentLabel(effectiveAgent, customAgents)
                }`,
                warn: true,
              }
            : missingAgent !== null
              ? {
                  text: `${agentLabel(missingAgent, customAgents)} isn't on $PATH — the pane will open, the command won't run`,
                  warn: true,
                }
              : null;

  /** Back to the home view — clears the pick, so home ⟺ nothing picked holds. */
  function goHome(): void {
    view.value = "home";
    selectedPath.value = null;
  }

  /** Switches to the config view, resetting the section focus to Layout. */
  function enterConfig(): void {
    view.value = "config";
    section.value = "layout";
  }

  /** Apply a recent's remembered combo when it is picked (still overridable). */
  function selectWorkspace(path: string): void {
    selectedPath.value = path;
    const entry = recents.find((recent) => recent.path === path);
    if (
      entry?.lastPresetId &&
      presets.some((p) => p.id === entry.lastPresetId)
    ) {
      selectedPresetId.value = entry.lastPresetId;
    }
    selectedAgent.value =
      typeof entry?.lastAgent === "string" ? entry.lastAgent : undefined;
    enterConfig();
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
        selectedPath.value = picked;
        selectedAgent.value = undefined; // fresh folder → first-agent default
        enterConfig();
      }
    } catch (err: unknown) {
      console.warn("Folder picker failed:", err);
    }
  }

  /** Fresh state every time the form is opened — never a stale attempt. */
  function openWorktreeForm(): void {
    worktreeForm.reset();
    view.value = "worktree";
  }

  /** Success hands straight to the config view, same as `pickFolder` — a
   * freshly created worktree is never in `missing`, so it opens like any
   * workspace (contract 2026-08-14). */
  function submitWorktree(): void {
    void worktreeForm.submit((path) => {
      selectedPath.value = path;
      selectedAgent.value = undefined;
      enterConfig();
    });
  }

  /**
   * Guards a second Open (button/Enter/double-click) during the first spawn.
   * Reads every signal fresh rather than closing over the render-scope
   * `selectedPreset`/`effectiveAgent` above: a row's dblclick handler calls
   * `selectWorkspace` and this in the same tick, before Preact re-renders, so
   * a stale closure would still see the *previous* pick's combo.
   */
  async function confirmOpen(): Promise<void> {
    const path = selectedPath.value;
    if (path === null || opening.value || missing.value.has(path)) {
      return;
    }
    const preset =
      presets.find((p) => p.id === selectedPresetId.value) ?? presets[0];
    const agent = resolveAgentChoice(
      selectedAgent.value,
      buildAgentChips(agents.value, customAgents),
    );
    opening.value = true;
    const ok = await onOpen(path, preset, agent);
    if (!ok) {
      opening.value = false;
      // Without this the board just re-enables the button and says nothing:
      // the manager writes its error into a terminal that is behind this
      // overlay, and on a first run there is no terminal to write to at all.
      failure.value = {
        path,
        presetId: preset.id,
        agent,
        message: "Couldn't start a shell here — check the folder and try again",
      };
    }
  }

  function movePreset(step: 1 | -1): void {
    const index = presets.findIndex((p) => p.id === selectedPresetId.value);
    const next = presets[(index + step + presets.length) % presets.length];
    selectedPresetId.value = next.id;
  }

  function moveAgent(step: 1 | -1): void {
    // Options are [agent0 … agentN, Shell only]; index N === Shell only.
    const options: AgentChoice[] = [...chips.map((chip) => chip.id), null];
    const current =
      effectiveAgent === null
        ? options.length - 1
        : options.indexOf(effectiveAgent);
    const next = options[(current + step + options.length) % options.length];
    selectedAgent.value = next;
  }

  function cycleSection(step: 1 | -1): void {
    const order: BoardSection[] = ["layout", "agent"];
    const index = order.indexOf(section.value);
    section.value = order[(index + step + order.length) % order.length];
  }

  function pickAgentByDigit(key: string): boolean {
    if (key === "0") {
      selectedAgent.value = null;
      section.value = "agent";
      return true;
    }
    const index = Number(key) - 1;
    if (index >= 0 && index < chips.length) {
      selectedAgent.value = chips[index].id;
      section.value = "agent";
      return true;
    }
    return false;
  }

  function startRename(preset: Preset): void {
    if (isBuiltIn(preset)) {
      return;
    }
    renamingId.value = preset.id;
    renameValue.value = preset.name;
    confirmDeleteId.value = null;
  }

  /** Rename and delete are mutually exclusive — opening one closes the other. */
  function openConfirmDelete(preset: Preset): void {
    if (isBuiltIn(preset)) {
      return;
    }
    confirmDeleteId.value = preset.id;
    renamingId.value = null;
  }

  function confirmDeletePreset(preset: Preset): void {
    deletePreset(preset.id);
    confirmDeleteId.value = null;
    if (selectedPresetId.value === preset.id) {
      selectedPresetId.value = presets[0].id;
    }
  }

  function commitRename(): void {
    const id = renamingId.value;
    const name = renameValue.value.trim();
    if (id !== null && name !== "") {
      renamePreset(id, name);
    }
    renamingId.value = null;
  }

  /** The combo line a recents row's title attribute shows on hover. */
  function describeCombo(recent: RecentWorkspace): string {
    const preset = presets.find((p) => p.id === recent.lastPresetId);
    return [
      preset?.name ?? null,
      typeof recent.lastAgent === "string"
        ? agentLabel(recent.lastAgent, customAgents)
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
  }

  function step(dir: 1 | -1): void {
    if (section.value === "layout") {
      movePreset(dir);
    } else {
      moveAgent(dir);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) {
      return; // rename input owns its keys (Enter/Esc handled inline)
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    // ⌘O / Ctrl+Shift+O work from either view — picking a folder is how you
    // get to the config view in the first place.
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
      if (confirmDeleteId.value !== null) {
        confirmDeleteId.value = null;
      } else if (view.value === "config" || view.value === "worktree") {
        // Contract 2026-08-14: Escape backs out of config (or the worktree
        // form) before it reaches the board's own cancel.
        goHome();
      } else if (canCancel) {
        onCancel();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Digits, arrows, Enter, section cycling, rename and layout-delete are
    // the Layout/Agent sections' own flow — unchanged, but scoped to the
    // config view now that home has no keyboard-navigable rail (contract
    // 2026-08-14: home is a mouse-driven recents list, click and remove only).
    if (view.value !== "config") {
      return;
    }
    if (/^[0-9]$/.test(event.key) && pickAgentByDigit(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    switch (key) {
      case "ArrowUp":
        step(-1);
        break;
      case "ArrowDown":
        step(1);
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "Tab":
        cycleSection(event.key === "ArrowLeft" || event.shiftKey ? -1 : 1);
        break;
      case "Enter":
        void confirmOpen();
        break;
      case "r":
        if (section.value === "layout") {
          startRename(selectedPreset);
        } else {
          return;
        }
        break;
      case "Backspace":
        if (section.value === "layout" && !isBuiltIn(selectedPreset)) {
          openConfirmDelete(selectedPreset);
        } else {
          return;
        }
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function configView() {
    return (
      <div class="board-config">
        <div class="board-config__scroll">
          <button class="board-back" onClick={goHome}>
            <DeckIcon icon={ArrowLeft} size={ROW_ICON} />
            Back
          </button>

          <div class="wshead">
            <h1 class="wshead__title">
              {pickedPath !== null
                ? folderName(pickedPath)
                : "No folder selected"}
            </h1>
            <div class="wshead__path">
              {pickedPath !== null
                ? home === ""
                  ? pickedPath
                  : tildify(pickedPath, home)
                : "Pick a recent folder or open a new one"}
            </div>
          </div>

          <OpenBoardLayoutSection
            presets={presets}
            focused={section.value === "layout"}
            selectedPresetId={selectedPresetId}
            renamingId={renamingId}
            renameValue={renameValue}
            confirmDeleteId={confirmDeleteId}
            onFocusSection={() => {
              section.value = "layout";
            }}
            onDoubleClickOpen={() => void confirmOpen()}
            onStartRename={startRename}
            onCommitRename={commitRename}
            onOpenConfirmDelete={openConfirmDelete}
            onDeletePreset={confirmDeletePreset}
            onNewPreset={() => onNewPreset(selectedPath.value)}
          />

          <section
            class={`sect ${section.value === "agent" ? "is-focused" : ""}`}
          >
            <div class="sect__head">
              <h2 class="sect__title">Agent</h2>
              <span class="sect__hint">Runs in every pane</span>
            </div>
            <div class="agents">
              {chips.map((chip, index) => {
                const avatar =
                  chip.logo === undefined
                    ? letterAvatar(chip.label, chip.id)
                    : null;
                return (
                  <button
                    key={chip.id}
                    class={`achip ${effectiveAgent === chip.id ? "is-selected" : ""} ${chip.missing ? "is-missing" : ""}`}
                    title={
                      chip.missing
                        ? `${chip.detail} — not on $PATH`
                        : chip.detail
                    }
                    onClick={() => {
                      selectedAgent.value = chip.id;
                      section.value = "agent";
                    }}
                    onDblClick={() => void confirmOpen()}
                  >
                    <kbd>{index + 1}</kbd>
                    {chip.logo !== undefined ? (
                      <img class="achip__logo" src={chip.logo} alt="" />
                    ) : (
                      <span
                        class="achip__letter"
                        style={{ color: `var(--${avatar?.color})` }}
                      >
                        {avatar?.letter}
                      </span>
                    )}
                    {chip.label}
                  </button>
                );
              })}
              <button
                class={`achip is-shell ${effectiveAgent === null ? "is-selected" : ""}`}
                onClick={() => {
                  selectedAgent.value = null;
                  section.value = "agent";
                }}
                onDblClick={() => void confirmOpen()}
              >
                <kbd>0</kbd>
                <span class="shellmark">$</span>Shell only
              </button>
            </div>
          </section>
        </div>

        <footer class="foot">
          <div class="foot__lead">
            <span
              class={`foot__sum ${notice?.warn ? "is-warning" : ""}`}
              // A failed Open has to reach a screen reader too — the summary
              // is the only place it is ever said.
              role={notice?.warn ? "status" : undefined}
            >
              {notice === null && pickedPath !== null ? (
                <>
                  Open <strong>{folderName(pickedPath)}</strong> as{" "}
                  <strong>{selectedPreset.name}</strong> with{" "}
                  <strong>
                    {effectiveAgent === null
                      ? "Shell"
                      : agentLabel(effectiveAgent, customAgents)}
                  </strong>
                </>
              ) : (
                notice?.text
              )}
            </span>
            <div class="foot__keys">
              <span>
                <b>↑↓</b> select
              </span>
              <span>
                <b>⇥</b> section
              </span>
              <span>
                <b>1–9</b> agent
              </span>
              {canCancel ? (
                <span>
                  <b>⎋</b> back
                </span>
              ) : null}
            </div>
          </div>
          <div class="foot__act">
            <button class="btn" onClick={goHome}>
              Back
            </button>
            <button
              class="btn btn--primary"
              onClick={() => void confirmOpen()}
              disabled={!workspaceValid || opening.value}
            >
              {opening.value ? "Opening…" : "Open"}
              <kbd>⏎</kbd>
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div
      class="open-board"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      {view.value === "home" ? (
        <OpenBoardHome
          homeDir={home}
          openFolderShortcut={openFolderShortcut}
          canCreateWorktree={worktreeHostAvailable}
          alive={groups.alive}
          missingGroup={groups.missing}
          describeCombo={describeCombo}
          onPickFolder={() => void pickFolder()}
          onCreateWorktree={openWorktreeForm}
          onSelect={selectWorkspace}
          onOpen={(path) => {
            selectWorkspace(path);
            void confirmOpen();
          }}
          onRemove={removeRecentRows}
        />
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
      ) : (
        configView()
      )}
    </div>
  );
}
