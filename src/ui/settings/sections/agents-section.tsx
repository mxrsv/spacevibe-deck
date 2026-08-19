import { Plus, Trash, X } from "@phosphor-icons/react";
import { Fragment } from "preact";
import { useSignal } from "@preact/signals";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import {
  agentBinary,
  AGENT_LABEL_MAX,
  BUILTIN_AGENTS,
  createCustomAgentId,
  isBuiltinAgentId,
  isProbeSafeName,
  type CustomAgent,
} from "../../../lib/agent-catalog";
import {
  revealDockTab,
  settings,
  updateSettings,
} from "../../../settings/settings-store";
import { settingsOpen } from "../../../chrome/events";
import { forgetWorkspaceAgent } from "../../../open-board/workspaces-store";
import { ConfigGroup, ConfigRow } from "../../controls/config-row";
import { CommitInput } from "../../controls/commit-input";
import { LaunchProfileEditor } from "../launch-profile-editor";

/**
 * Why a declared command is rejected, or `null` when it is fine. The binary is
 * the security-relevant part: it is interpolated into the discovery probe's
 * shell script, so the same character class Rust enforces is enforced here to
 * say WHY rather than let the agent silently never resolve.
 */
function commandProblem(command: string): string | null {
  const binary = agentBinary(command);
  if (binary === "") {
    return "a command is required";
  }
  if (!isProbeSafeName(binary)) {
    return "the command name may only use letters, digits and . _ - / ~ +";
  }
  return null;
}

/**
 * Why a declared name is rejected, or `null` when it is fine.
 *
 * The label is not only a display string: `agentProcessMatchers` sends it to
 * the host as the identity a matched process reports back, and the rest of the
 * app reads that identity as an agent ID — `dotColor` for the pane's dot,
 * `isPromptAgentId` for the Prompt Board's pickers. A label spelled exactly
 * like a built-in ID (`claude`, `codex`, …) therefore hands an unrelated CLI
 * that built-in's colour and its prompt snippets. Reserved IDs are refused
 * here, where the user can still see why; the built-in LABELS stay refused for
 * the older reason, that two rows reading "Claude Code" cannot be told apart.
 */
function labelProblem(
  label: string,
  others: readonly CustomAgent[],
): string | null {
  const trimmed = label.trim();
  if (trimmed === "") {
    return "a name is required";
  }
  if (trimmed.length > AGENT_LABEL_MAX) {
    return `names stay under ${AGENT_LABEL_MAX} characters`;
  }
  if (isBuiltinAgentId(trimmed)) {
    return `"${trimmed}" is a built-in agent's id — pick another name`;
  }
  const taken =
    others.some((agent) => agent.label === trimmed) ||
    BUILTIN_AGENTS.some((agent) => agent.label === trimmed);
  return taken ? "that name is already used" : null;
}

/** Which field is open for editing — one row's key or its value, never both. */
const labelKey = (id: string): string => `${id}:label`;
const commandKey = (id: string): string => `${id}:command`;

/**
 * The Agents category: the built-in four, locked, then every declared agent
 * with its command — one `cfg-row` each, edited in place (DL-12).
 */
export function AgentsSection() {
  const customAgents = settings.value.customAgents;
  const editing = useSignal<string | null>(null);
  /** Why the last in-place edit was refused, and which row refused it. */
  const editError = useSignal<{ id: string; message: string } | null>(null);
  const draftOpen = useSignal(false);
  const draftLabel = useSignal("");
  const draftCommand = useSignal("");
  const draftError = useSignal<string | null>(null);

  const replace = (next: readonly CustomAgent[]): void => {
    updateSettings({ customAgents: next });
  };

  const renameAgent = (id: string, label: string): void => {
    const others = customAgents.filter((agent) => agent.id !== id);
    const problem = labelProblem(label, others);
    if (problem !== null) {
      // Rejecting in silence was the old behaviour: the row snapped back with
      // no reason given, and closing the editor took the draft with it.
      editError.value = { id, message: problem };
      return;
    }
    editError.value = null;
    replace(
      customAgents.map((agent) =>
        agent.id === id ? { ...agent, label: label.trim() } : agent,
      ),
    );
  };

  const retargetAgent = (id: string, command: string): void => {
    const problem = commandProblem(command);
    if (problem !== null) {
      editError.value = { id, message: problem };
      return;
    }
    editError.value = null;
    replace(
      customAgents.map((agent) =>
        agent.id === id ? { ...agent, command: command.trim() } : agent,
      ),
    );
  };

  const removeAgent = (id: string): void => {
    replace(customAgents.filter((agent) => agent.id !== id));
    // The id is now free again, and re-adding the same label would mint it a
    // second time — so any workspace still remembering it has to let go now,
    // or it would silently open with whatever the next agent of that name is.
    forgetWorkspaceAgent(id);
  };

  const commitDraft = (): void => {
    const label = draftLabel.value;
    const command = draftCommand.value;
    const problem =
      labelProblem(label, customAgents) ?? commandProblem(command);
    if (problem !== null) {
      draftError.value = problem;
      return;
    }
    replace([
      ...customAgents,
      {
        id: createCustomAgentId(label, customAgents),
        label: label.trim(),
        command: command.trim(),
      },
    ]);
    draftOpen.value = false;
    draftLabel.value = "";
    draftCommand.value = "";
    draftError.value = null;
  };

  /**
   * Escape inside the add form discards it and goes NO further.
   *
   * This form is the one draft in Settings that `CommitInput` cannot own
   * (DL-6.3): two fields commit atomically, so there is no single value to
   * blur-commit. Without this, Escape reached the screen's own handler, which
   * closed Settings — costing the half-typed agent AND the screen to one
   * press, the failure the design spec names by hand. `stopPropagation` is
   * what keeps the two apart; the discard itself is exactly what the row's
   * own discard button does.
   */
  const cancelDraftOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    draftOpen.value = false;
    draftLabel.value = "";
    draftCommand.value = "";
    draftError.value = null;
  };

  /**
   * Settings → Token Usage, in one click. Writes the two signals directly
   * instead of calling `closeSettingsPanel` (app.tsx): that helper hands focus
   * back to the active pane, and here focus must land inside the screen that
   * is opening — the dock's usage tab takes it, exactly as `SettingsScreen`
   * does. Same mutual-exclusion rule `toggleUsagePanel` enforces (spec
   * §Surface, major M4).
   *
   * No draft preflight is needed here, unlike the Settings toggle: a
   * PresetEditor/SavePresetDialog scrim sits at z-40 over Settings' z-35, so
   * this button is physically unclickable while a draft is up.
   */
  const openUsage = (): void => {
    settingsOpen.value = false;
    revealDockTab("usage");
  };

  return (
    <>
      {/* The built-in list is the editor's own since 2026-08-19: a row prints
          the command its agent will launch with, not the agent's name beside
          a locked badge. `LaunchProfileEditor` walks `BUILTIN_AGENTS` itself,
          so this section states the group and hands the list over. */}
      <ConfigGroup label="Built in" />
      <LaunchProfileEditor />

      <ConfigGroup label="Declared" />
      {customAgents.map((agent) => (
        <Fragment key={agent.id}>
          <div
            class="cfg-row cfg-row--item"
            // Leaving the row commits and closes whichever field was open. A
            // click elsewhere is how people leave a field; without this the row
            // would stay a form until something else took focus.
            onFocusOut={() => {
              editing.value = null;
            }}
          >
            <div class="cfg-row__key">
              {editing.value === labelKey(agent.id) ? (
                <CommitInput
                  value={agent.label}
                  placeholder="name"
                  ariaLabel={`Name for ${agent.label}`}
                  autoFocus
                  onCommit={(label) => renameAgent(agent.id, label)}
                />
              ) : (
                <button
                  type="button"
                  class="cfg-row__label cfg-row__label--edit"
                  title="Rename"
                  onClick={() => {
                    editing.value = labelKey(agent.id);
                  }}
                >
                  {agent.label}
                </button>
              )}
            </div>
            <div class="cfg-row__value">
              {editing.value === commandKey(agent.id) ? (
                <CommitInput
                  value={agent.command}
                  placeholder="command"
                  ariaLabel={`Command for ${agent.label}`}
                  autoFocus
                  onCommit={(command) => retargetAgent(agent.id, command)}
                />
              ) : (
                <button
                  type="button"
                  class="cfg-btn"
                  title={`${agent.command} — click to edit`}
                  onClick={() => {
                    editing.value = commandKey(agent.id);
                  }}
                >
                  {agent.command}
                </button>
              )}
            </div>
            <button
              type="button"
              class="cfg-row__remove"
              aria-label={`Remove ${agent.label}`}
              title={`Remove ${agent.label}`}
              onClick={() => removeAgent(agent.id)}
            >
              <DeckIcon icon={Trash} size={ROW_ICON} />
            </button>
          </div>
          {editError.value?.id === agent.id && (
            <div class="cfg-custom--error" role="status">
              {editError.value.message}
            </div>
          )}
        </Fragment>
      ))}

      {draftOpen.value ? (
        <>
          <div class="cfg-row cfg-row--item">
            <div class="cfg-row__key">
              <input
                type="text"
                class="text-input text-input--small"
                placeholder="name"
                aria-label="New agent name"
                value={draftLabel.value}
                onInput={(event) => {
                  draftLabel.value = event.currentTarget.value;
                  draftError.value = null;
                }}
                onKeyDown={cancelDraftOnEscape}
              />
            </div>
            <div class="cfg-row__value">
              <input
                type="text"
                class="text-input text-input--small"
                placeholder="aider --model sonnet"
                aria-label="New agent command"
                value={draftCommand.value}
                onInput={(event) => {
                  draftCommand.value = event.currentTarget.value;
                  draftError.value = null;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitDraft();
                    return;
                  }
                  cancelDraftOnEscape(event);
                }}
              />
            </div>
            <button
              type="button"
              class="cfg-row__remove"
              aria-label="Discard the new agent"
              onClick={() => {
                draftOpen.value = false;
                draftError.value = null;
              }}
            >
              <DeckIcon icon={X} size={ROW_ICON} />
            </button>
          </div>
          {draftError.value !== null && (
            <div class="cfg-custom--error" role="status">
              {draftError.value}
            </div>
          )}
        </>
      ) : null}

      <ConfigRow
        label="Add agent"
        desc="A name and the command to type into each pane"
      >
        <button
          type="button"
          class="cfg-btn"
          onClick={() => {
            if (draftOpen.value) {
              commitDraft();
              return;
            }
            draftOpen.value = true;
          }}
        >
          {draftOpen.value ? "add" : <DeckIcon icon={Plus} size={ROW_ICON} />}
        </button>
      </ConfigRow>

      <ConfigRow
        label="Token usage"
        desc="Tokens and estimated cost for Claude Code and Codex"
      >
        <button type="button" class="cfg-btn" onClick={openUsage}>
          open …
        </button>
      </ConfigRow>
    </>
  );
}
