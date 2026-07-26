import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { open } from "@tauri-apps/plugin-dialog";
import { countLeaves } from "../lib/split-tree";
import { isBuiltIn, type Preset } from "../lib/preset-schema";
import {
  folderName,
  formatRelativeTime,
  resolveAgentChoice,
} from "../lib/workspace-recents";
import type { AgentChoice, RecentWorkspace } from "../lib/workspace-recents";
import { tildify } from "../lib/process-info";
import { defaultPtyClient, type DetectedAgent } from "../terminal/pty-client";
import {
  boardPresets,
  deletePreset,
  presetsData,
  renamePreset,
} from "../presets/presets-store";
import { workspacesData } from "./workspaces-store";
import { LogoPanel } from "./logo-panel";
import { PresetThumb } from "../presets/preset-thumb";
import claudeLogo from "../assets/agent-claude.svg";
import codexLogo from "../assets/agent-codex.svg";
import geminiLogo from "../assets/agent-gemini.svg";

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

/** Human names for allowlisted agent binaries (chip label). */
const AGENT_LABELS: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

function agentLabel(name: string): string {
  return AGENT_LABELS[name] ?? name;
}

/** Brand logo (chip icon) per allowlisted agent binary; url resolved by Vite. */
const AGENT_LOGOS: Readonly<Record<string, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  gemini: geminiLogo,
};

function agentLogo(name: string): string | undefined {
  return AGENT_LOGOS[name];
}

export function OpenBoard({
  canCancel,
  onCancel,
  onOpen,
  onNewPreset,
}: OpenBoardProps) {
  const recents = workspacesData.value.recents;
  const presets = boardPresets();
  const home = useSignal("");
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
    defaultPtyClient
      .detectAgents()
      .then((found) => {
        agents.value = found;
      })
      .catch((err: unknown) => {
        console.warn("detect_agents failed:", err);
        agents.value = []; // board degrades to Shell only (FR-025)
      });
    homeDir()
      .then((dir) => {
        home.value = dir;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const paths = recents.map((recent) => recent.path);
    if (paths.length === 0) {
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
  const effectiveAgent = resolveAgentChoice(selectedAgent.value, agents.value);
  const workspaceValid =
    selectedPath.value !== null && !missing.value.has(selectedPath.value);

  // A just-picked folder that is not in Recents yet shows as a live entry at
  // the top of the list (selected), rather than a separate line — it only
  // lands in `workspaces.json` once the user actually opens it.
  const pickedPath = selectedPath.value;
  const displayRecents: readonly RecentWorkspace[] =
    pickedPath !== null && !recents.some((r) => r.path === pickedPath)
      ? [{ path: pickedPath, lastOpenedAt: Date.now() }, ...recents]
      : recents;

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
    const selectable = displayRecents.filter((r) => !missing.value.has(r.path));
    if (selectable.length === 0) {
      return;
    }
    const index = selectable.findIndex((r) => r.path === selectedPath.value);
    const next =
      selectable[(index + step + selectable.length) % selectable.length];
    selectWorkspace(next.path);
  }

  function movePreset(step: 1 | -1): void {
    const index = presets.findIndex((p) => p.id === selectedPresetId.value);
    const next = presets[(index + step + presets.length) % presets.length];
    selectedPresetId.value = next.id;
  }

  function moveAgent(step: 1 | -1): void {
    // Options are [agent0 … agentN, Shell only]; index N === Shell only.
    const options: AgentChoice[] = [
      ...agents.value.map((agent) => agent.name),
      null,
    ];
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
    if (index >= 0 && index < agents.value.length) {
      selectedAgent.value = agents.value[index].name;
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
    switch (event.key) {
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
        if (event.metaKey) {
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
        if (section.value === "layout" && !isBuiltIn(selectedPreset)) {
          confirmDeleteId.value = selectedPreset.id;
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

  return (
    <div
      class="open-board"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <LogoPanel />
      <div class="board-side">
        <div class="board-side__scroll">
          <section
            class={`board-group ${section.value === "workspace" ? "is-focused" : ""}`}
          >
            <h2 class="board-group__title">
              Workspace <span>recent</span>
            </h2>
            <ul class="workspace-list">
              {displayRecents.map((recent) => {
                const gone = missing.value.has(recent.path);
                const preset = presets.find(
                  (p) => p.id === recent.lastPresetId,
                );
                const agentGone =
                  typeof recent.lastAgent === "string" &&
                  !agents.value.some((a) => a.name === recent.lastAgent);
                return (
                  <li key={recent.path}>
                    <button
                      class={`workspace-row ${recent.path === selectedPath.value ? "is-selected" : ""} ${gone ? "is-missing" : ""}`}
                      disabled={gone}
                      onClick={() => selectWorkspace(recent.path)}
                      onDblClick={() => void confirmOpen()}
                    >
                      <span class="workspace-row__head">
                        <span class="workspace-row__name">
                          {folderName(recent.path)}
                          {gone ? <em> — missing</em> : null}
                        </span>
                        <span class="workspace-row__time">
                          {formatRelativeTime(recent.lastOpenedAt, Date.now())}
                        </span>
                      </span>
                      <span class="workspace-row__sub">
                        <span class="workspace-row__path">
                          {home.value === ""
                            ? recent.path
                            : tildify(recent.path, home.value)}
                        </span>
                        {/* A remembered Shell (`null`) is not shown: it no
                            longer preselects anything, so labeling the row
                            "Shell" would contradict the first-agent default. */}
                        {preset || typeof recent.lastAgent === "string" ? (
                          <span
                            class={`workspace-row__combo ${agentGone ? "is-stale" : ""}`}
                          >
                            {preset ? preset.name : "—"}
                            {typeof recent.lastAgent === "string" ? (
                              <>
                                {" · "}
                                {agentLabel(recent.lastAgent)}
                              </>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              class="workspace-open-folder"
              onClick={() => void pickFolder()}
            >
              ＋ Open folder…
            </button>
          </section>

          <section
            class={`board-group ${section.value === "layout" ? "is-focused" : ""}`}
          >
            <h2 class="board-group__title">
              Layout <span>split + cwd</span>
            </h2>
            <div class="preset-chips">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  class={`preset-chip ${preset.id === selectedPresetId.value ? "is-selected" : ""}`}
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
                  <PresetThumb layout={preset.layout} />
                  {renamingId.value === preset.id ? (
                    <input
                      class="preset-chip__rename"
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
                    <span class="preset-chip__name">{preset.name}</span>
                  )}
                  {confirmDeleteId.value === preset.id ? (
                    <span class="preset-chip__confirm">
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
                class="preset-chip preset-chip--new"
                onClick={() => onNewPreset(selectedPath.value)}
              >
                ＋ new
              </button>
            </div>
          </section>

          <section
            class={`board-group ${section.value === "agent" ? "is-focused" : ""}`}
          >
            <h2 class="board-group__title">
              Agent <span>on all panes</span>
            </h2>
            <div class="agent-chips">
              {agents.value.map((agent, index) => {
                const logo = agentLogo(agent.name);
                return (
                  <button
                    key={agent.name}
                    class={`agent-chip ${effectiveAgent === agent.name ? "is-selected" : ""}`}
                    title={agent.path}
                    onClick={() => {
                      selectedAgent.value = agent.name;
                      section.value = "agent";
                    }}
                    onDblClick={() => void confirmOpen()}
                  >
                    <kbd>{index + 1}</kbd>
                    {logo && <img class="agent-chip__logo" src={logo} alt="" />}
                    {agentLabel(agent.name)}
                  </button>
                );
              })}
              <button
                class={`agent-chip is-shell ${effectiveAgent === null ? "is-selected" : ""}`}
                onClick={() => {
                  selectedAgent.value = null;
                  section.value = "agent";
                }}
                onDblClick={() => void confirmOpen()}
              >
                <kbd>0</kbd>Shell only
              </button>
            </div>
          </section>
        </div>

        <footer class="board-footer">
          <span
            class={`board-footer__summary ${notice?.warn ? "is-warning" : ""}`}
            // A failed Open has to reach a screen reader too — the summary is
            // the only place it is ever said.
            role={notice?.warn ? "status" : undefined}
          >
            {notice === null && pickedPath !== null ? (
              <>
                Open <strong>{folderName(pickedPath)}</strong> as{" "}
                <strong>{selectedPreset.name}</strong> with{" "}
                <strong>
                  {effectiveAgent === null
                    ? "Shell"
                    : agentLabel(effectiveAgent)}
                </strong>
              </>
            ) : (
              notice?.text
            )}
          </span>
          <div class="board-footer__actions">
            <button onClick={onCancel} disabled={!canCancel}>
              Cancel
            </button>
            <button
              class="is-primary"
              onClick={() => void confirmOpen()}
              disabled={!workspaceValid || opening.value}
            >
              {opening.value ? "Opening…" : "Open"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
