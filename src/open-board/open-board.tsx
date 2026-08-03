import { invoke } from "@tauri-apps/api/core";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "@tauri-apps/plugin-dialog";
import { countLeaves } from "../lib/split-tree";
import { isBuiltIn, type Preset } from "../lib/preset-schema";
import {
  folderName,
  formatRelativeTime,
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
import { logoDataUrl } from "../settings/logo-store";
import { PresetThumb } from "../presets/preset-thumb";
import claudeLogo from "../assets/agent-claude.svg";
import codexLogo from "../assets/agent-codex.svg";
import geminiLogo from "../assets/agent-gemini.svg";
import { formatShortcutBinding } from "../lib/shortcut-label";

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

type BoardSection = "workspace" | "layout" | "agent";

/** Brand logo (chip icon) per built-in agent; url resolved by Vite. */
const AGENT_LOGOS: Readonly<Record<string, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  gemini: geminiLogo,
};

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

/** The default Deck mark, shown until the user sets a logo in Settings. */
function DefaultMark() {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="Deck">
      <rect x="6" y="6" width="16" height="16" rx="2" />
      <rect x="26" y="6" width="16" height="16" rx="2" />
      <rect x="6" y="26" width="16" height="16" rx="2" />
      <rect x="26" y="26" width="16" height="16" rx="2" />
    </svg>
  );
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
  const first = recents[0];
  const selectedPath = useSignal<string | null>(first?.path ?? null);
  const selectedPresetId = useSignal<string>(
    (first?.lastPresetId && presets.some((p) => p.id === first.lastPresetId)
      ? first.lastPresetId
      : presetsData.value.lastUsedId) ?? presets[0].id,
  );
  // Raw selected choice this session; the *effective* agent is this resolved
  // against detected agents, so a late detect() or a stale memory can't launch
  // something that is not on $PATH. `undefined` = no explicit pick, which
  // resolves to the first detected agent; a remembered Shell (`null`) is
  // deliberately not preloaded — Shell is only ever an explicit click.
  const selectedAgent = useSignal<AgentChoice | undefined>(
    typeof first?.lastAgent === "string" ? first.lastAgent : undefined,
  );
  const agents = useSignal<readonly DetectedAgent[]>([]);
  const customAgents = settings.value.customAgents;
  const section = useSignal<BoardSection>("workspace");
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
  const workspaceValid =
    selectedPath.value !== null && !missing.value.has(selectedPath.value);

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

  // A just-picked folder that is not in Recents yet shows as a live entry at
  // the top of the list (selected), rather than a separate line — it only
  // lands in `workspaces.json` once the user actually opens it.
  const pickedPath = selectedPath.value;
  const displayRecents: readonly RecentWorkspace[] =
    pickedPath !== null && !recents.some((r) => r.path === pickedPath)
      ? [{ path: pickedPath, lastOpenedAt: Date.now() }, ...recents]
      : recents;
  const groups = partitionRecents(displayRecents, missing.value);

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

  /** Apply a recent's remembered combo when it is picked (still overridable). */
  function selectWorkspace(path: string): void {
    selectedPath.value = path;
    section.value = "workspace";
    const entry = recents.find((recent) => recent.path === path);
    if (
      entry?.lastPresetId &&
      presets.some((p) => p.id === entry.lastPresetId)
    ) {
      selectedPresetId.value = entry.lastPresetId;
    }
    selectedAgent.value =
      typeof entry?.lastAgent === "string" ? entry.lastAgent : undefined;
  }

  /**
   * Remove rows from Recents, moving the selection off them FIRST — if the
   * selected path left the list while still selected, `displayRecents` would
   * fabricate a live entry for it and the row would come straight back.
   *
   * Reads the store, not this render's closure: a second removal landing
   * before the re-render must not see already-deleted rows, or it could move
   * the selection onto one of them and resurrect it. Paths that are not
   * actually stored (the fabricated just-picked row) are left untouched, so
   * Backspace can never discard a fresh folder-picker result.
   */
  function removeRecentRows(paths: readonly string[]): void {
    const stored = workspacesData.value.recents;
    const removable = paths.filter((path) =>
      stored.some((entry) => entry.path === path),
    );
    if (removable.length === 0) {
      return;
    }
    const removed = new Set(removable);
    const current = selectedPath.value;
    if (current !== null && removed.has(current)) {
      const parts = partitionRecents(stored, missing.value);
      const ordered = [...parts.alive, ...parts.missing];
      const index = ordered.findIndex((r) => r.path === current);
      const after = ordered.slice(index + 1).find((r) => !removed.has(r.path));
      const before = ordered
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((r) => !removed.has(r.path));
      const next = (after ?? before)?.path ?? null;
      if (next !== null) {
        selectWorkspace(next); // applies the next row's remembered combo too
      } else {
        selectedPath.value = null;
      }
    }
    removeWorkspaceRecents(removable);
  }

  async function pickFolder(): Promise<void> {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") {
        selectedPath.value = picked;
        selectedAgent.value = undefined; // fresh folder → first-agent default
      }
    } catch (err: unknown) {
      console.warn("Folder picker failed:", err);
    }
  }

  /** Guards a second Open (button/Enter/double-click) during the first spawn. */
  async function confirmOpen(): Promise<void> {
    if (!workspaceValid || selectedPath.value === null || opening.value) {
      return;
    }
    const path = selectedPath.value;
    opening.value = true;
    const ok = await onOpen(path, selectedPreset, effectiveAgent);
    if (!ok) {
      opening.value = false;
      // Without this the board just re-enables the button and says nothing:
      // the manager writes its error into a terminal that is behind this
      // overlay, and on a first run there is no terminal to write to at all.
      failure.value = {
        path,
        presetId: selectedPreset.id,
        agent: effectiveAgent,
        message: "Couldn't start a shell here — check the folder and try again",
      };
    }
  }

  function moveWorkspace(step: 1 | -1): void {
    // Visual order (alive, then Missing) — arrows walk every row, including
    // missing ones, so ⌫ can reach and remove them; Enter stays guarded.
    const ordered = [...groups.alive, ...groups.missing];
    if (ordered.length === 0) {
      return;
    }
    const index = ordered.findIndex((r) => r.path === selectedPath.value);
    const next = ordered[(index + step + ordered.length) % ordered.length];
    selectWorkspace(next.path);
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
    const order: BoardSection[] = ["workspace", "layout", "agent"];
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

  function commitRename(): void {
    const id = renamingId.value;
    const name = renameValue.value.trim();
    if (id !== null && name !== "") {
      renamePreset(id, name);
    }
    renamingId.value = null;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) {
      return; // rename input owns its keys (Enter/Esc handled inline)
    }
    if (/^[0-9]$/.test(event.key) && pickAgentByDigit(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
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
      case "Escape":
        if (confirmDeleteId.value !== null) {
          confirmDeleteId.value = null;
        } else if (canCancel) {
          onCancel();
        }
        break;
      case "o":
        if (
          hasPrimaryModifier(event) &&
          (getDesktopEnvironment().platform !== "windows" || event.shiftKey)
        ) {
          void pickFolder();
        } else {
          return;
        }
        break;
      case "r":
        if (section.value === "layout") {
          startRename(selectedPreset);
        } else {
          return;
        }
        break;
      case "Backspace":
        // Recents remove immediately (same semantics as the row ×; undo is
        // just reopening the folder). Presets keep their confirm — a deleted
        // layout takes real work to rebuild.
        if (section.value === "workspace" && selectedPath.value !== null) {
          removeRecentRows([selectedPath.value]);
        } else if (section.value === "layout" && !isBuiltIn(selectedPreset)) {
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

  function step(dir: 1 | -1): void {
    if (section.value === "workspace") {
      moveWorkspace(dir);
    } else if (section.value === "layout") {
      movePreset(dir);
    } else {
      moveAgent(dir);
    }
  }

  /** One recents row — an li (not a button) so the × inside stays clickable. */
  function recentRow(recent: RecentWorkspace) {
    const gone = missing.value.has(recent.path);
    const selected = recent.path === selectedPath.value;
    // The fabricated just-picked row is not a stored recent: nothing to remove.
    const stored = recents.some((entry) => entry.path === recent.path);
    const preset = presets.find((p) => p.id === recent.lastPresetId);
    const combo = [
      preset?.name ?? null,
      typeof recent.lastAgent === "string"
        ? agentLabel(recent.lastAgent, customAgents)
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
    return (
      <li
        key={recent.path}
        class={`row ${selected ? "is-selected" : ""} ${gone ? "is-missing" : ""}`}
        aria-current={selected ? "true" : undefined}
        title={combo === "" ? undefined : `Opens as ${combo}`}
        onClick={() => selectWorkspace(recent.path)}
        onDblClick={() => void confirmOpen()}
      >
        <svg class="row__ico" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.6 12.4v-8.8a1 1 0 0 1 1-1h3.1l1.4 1.8h6.3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1Z" />
        </svg>
        <span class="row__body">
          <span class="row__name">{folderName(recent.path)}</span>
          <span class="row__meta">
            <span class="row__path">
              {home === "" ? recent.path : tildify(recent.path, home)}
            </span>
            <span class="row__time">
              {formatRelativeTime(recent.lastOpenedAt, Date.now())}
            </span>
          </span>
        </span>
        {stored ? (
          <button
            class="row__x"
            aria-label={`Remove ${folderName(recent.path)} from recents`}
            onClick={(event) => {
              event.stopPropagation();
              removeRecentRows([recent.path]);
            }}
            // A second rapid click fires dblclick — without this it bubbles
            // to the row's onDblClick and opens the workspace.
            onDblClick={(event) => event.stopPropagation()}
          >
            ×
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <div
      class="open-board"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <div class="rail">
        <div class="rail__head">
          <span class="applogo">
            {logoDataUrl.value === "" ? (
              <DefaultMark />
            ) : (
              <img src={logoDataUrl.value} alt="App logo" />
            )}
          </span>
          <span class="rail__title">Workspace</span>
          <span class="rail__count">{displayRecents.length}</span>
        </div>
        <div class="rail__act">
          <button class="openfolder" onClick={() => void pickFolder()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.6 12.4v-8.8a1 1 0 0 1 1-1h3.1l1.4 1.8h6.3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-10.8a1 1 0 0 1-1-1Z" />
              <path d="M8 6.7v4M6 8.7h4" />
            </svg>
            Open Folder…<kbd>{openFolderShortcut}</kbd>
          </button>
        </div>
        <ul class="rail__scroll" aria-label="Recent workspaces">
          {groups.alive.map(recentRow)}
          {groups.missing.length > 0 ? (
            <li class="gsep">
              <span>Missing</span>
              <button
                onClick={() =>
                  removeRecentRows(groups.missing.map((r) => r.path))
                }
              >
                Remove {groups.missing.length}
              </button>
            </li>
          ) : null}
          {groups.missing.map(recentRow)}
        </ul>
      </div>
      <div class="detail">
        <div class="detail__scroll">
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

          <section
            class={`sect ${section.value === "layout" ? "is-focused" : ""}`}
          >
            <div class="sect__head">
              <h2 class="sect__title">Layout</h2>
              <span class="sect__hint">Hover a card to rename or delete</span>
            </div>
            <div class="lgrid">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  class={`lcard ${preset.id === selectedPresetId.value ? "is-selected" : ""}`}
                  title={`${countLeaves(preset.layout)} ${countLeaves(preset.layout) === 1 ? "pane" : "panes"}${preset.cwds ? " · cwds" : ""}`}
                  onClick={() => {
                    selectedPresetId.value = preset.id;
                    section.value = "layout";
                  }}
                  onDblClick={() => void confirmOpen()}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    startRename(preset);
                  }}
                >
                  {isBuiltIn(preset) ? (
                    <span class="builtin" title="Built-in preset">
                      •
                    </span>
                  ) : null}
                  <PresetThumb layout={preset.layout} />
                  <span class="lcard__foot">
                    {renamingId.value === preset.id ? (
                      <input
                        class="lcard__rename"
                        value={renameValue.value}
                        ref={(el) => el?.focus()}
                        onInput={(event) => {
                          renameValue.value = (
                            event.target as HTMLInputElement
                          ).value;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitRename();
                          }
                          if (event.key === "Escape") {
                            renamingId.value = null;
                          }
                          event.stopPropagation();
                        }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <span class="lcard__name">{preset.name}</span>
                    )}
                    <span class="lcard__n">{countLeaves(preset.layout)}</span>
                  </span>
                  {!isBuiltIn(preset) ? (
                    // Tools stop dblclick too — two rapid clicks would
                    // otherwise bubble to the card's onDblClick and open.
                    <span
                      class="lcard__tools"
                      onDblClick={(event) => event.stopPropagation()}
                    >
                      <button
                        aria-label={`Rename ${preset.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          startRename(preset);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        class="x"
                        aria-label={`Delete ${preset.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openConfirmDelete(preset);
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ) : null}
                  {confirmDeleteId.value === preset.id ? (
                    <span
                      class="lcard__confirm"
                      onDblClick={(event) => event.stopPropagation()}
                    >
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          deletePreset(preset.id);
                          confirmDeleteId.value = null;
                          if (selectedPresetId.value === preset.id) {
                            selectedPresetId.value = presets[0].id;
                          }
                        }}
                      >
                        delete
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          confirmDeleteId.value = null;
                        }}
                      >
                        keep
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
              <button
                class="lcard lcard--new"
                onClick={() => onNewPreset(selectedPath.value)}
              >
                <span>＋ New Layout</span>
                <small>From current window</small>
              </button>
            </div>
          </section>

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
              <span>
                <b>⌫</b> remove
              </span>
              {canCancel ? (
                <span>
                  <b>⎋</b> close
                </span>
              ) : null}
            </div>
          </div>
          <div class="foot__act">
            <button class="btn" onClick={onCancel} disabled={!canCancel}>
              Cancel
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
    </div>
  );
}
