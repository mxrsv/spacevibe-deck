import { ArrowUp, ArrowsOutSimple, CaretDown, Folder } from "@phosphor-icons/react";
import type { AgentOption } from "../lib/agent-catalog";
import { AGENT_LOGOS } from "../lib/agent-logos";
import { letterAvatar } from "../lib/letter-avatar";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { workspaceLabel } from "../lib/workspace-label";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import {
  mergeRuntimeDefaults,
  parseRuntimeKey,
  runtimeFor,
  runtimeKey,
  runtimeOptions,
  type AgentRuntimeDefault,
} from "./runtime-catalog";
import {
  withAgent,
  withPrompt,
  withPromptExpanded,
  withRuntime,
  type DraftProblem,
  type NewTaskDraft,
} from "./new-task-draft";

/**
 * The prompt composer and the one context toolbar under it, shared by the Open
 * Board and Quick Launch (design §4). It owns no state: the draft comes in and
 * every edit goes back out, because both surfaces edit the SAME draft and a
 * local copy here would let them disagree.
 *
 * Ported from the owner-approved gallery specimen
 * (`src/gallery/sections/board-section.tsx`, 2026-08-23) with its placeholder
 * data replaced. That file's `AGENT_MODELS` values are invented for the mock —
 * real values come from the catalog seed plus `settings.agentModels`.
 *
 * The toolbar prints IDENTITY, never field labels: folder icon + name, agent
 * logo + name. `Workspace` / `Agent` / `Model` / `Effort` appear only as
 * `aria-label`s, where a screen reader needs them and the eye does not.
 */

/** Sentinel option values — a workspace action rather than a workspace. */
const PICK_FOLDER = "__pick-folder";
const CREATE_WORKSPACE = "__create-workspace";
const CREATE_WORKTREE = "__create-worktree";

export type LauncherPending =
  | "picking-folder"
  | "creating-workspace"
  | "creating-worktree"
  | "opening-agent"
  | "sending-prompt";

export interface LauncherFieldsProps {
  /** Prefix for the ids this subtree mints; two mounts must not collide. */
  readonly idPrefix: string;
  /** Quick Launch's tighter shape, and the only mount whose prompt collapses. */
  readonly compact: boolean;
  readonly draft: NewTaskDraft;
  readonly agents: readonly AgentOption[];
  readonly recents: readonly RecentWorkspace[];
  /** `settings.agentModels`. */
  readonly declaredModels: Readonly<Record<string, readonly string[]>>;
  /**
   * `settings.agentRuntimeDefaults`. The SETTINGS default wins over the catalog
   * seed (design §3.5, §7), so the merge happens here, before `withAgent` sees
   * a capability — which is what keeps `new-task-draft.ts` free of the
   * settings store.
   */
  readonly agentRuntimeDefaults: Readonly<Record<string, AgentRuntimeDefault>>;
  /** Electron-only host capabilities; omitted, never shown inert (DL-19.7). */
  readonly canCreateWorkspace: boolean;
  readonly canCreateWorktree: boolean;
  readonly pending: LauncherPending | null;
  readonly problem: DraftProblem | null;
  /** A message the launch attempt produced, or null. */
  readonly notice: string | null;
  onDraftChange(next: NewTaskDraft): void;
  onPickFolder(): void;
  onCreateWorkspace(): void;
  onCreateWorktree(): void;
  onManageAgents(): void;
  onStartTask(): void;
  onOpenAgent(): void;
  /** Quick Launch only — hands the whole draft to the Open Board. */
  onOpenFullComposer?: () => void;
}

function AgentMark({ id, label }: { readonly id: string; readonly label: string }) {
  const logo = AGENT_LOGOS[id];
  if (logo !== undefined) {
    return <img class="nt-agent-mark" src={logo} alt="" />;
  }
  const avatar = letterAvatar(label, id);
  return (
    <span class="nt-agent-mark nt-agent-mark--letter" style={{ color: `var(--${avatar.color})` }}>
      {avatar.letter}
    </span>
  );
}

/** What a blocked launch says, in the user's words rather than the enum's. */
export function problemMessage(problem: DraftProblem): string {
  switch (problem) {
    case "no-runnable-agent":
      return "No agent is installed and enabled — open Settings to add one";
    case "no-workspace":
      return "Pick a folder to work in";
    case "no-agent":
      return "Pick an agent to run the task";
    case "agent-unavailable":
      return "That agent is not on your PATH — open Settings to fix it";
    case "empty-prompt":
      return "Describe the task first";
  }
}

export function LauncherFields(props: LauncherFieldsProps) {
  const { draft, agents } = props;
  const promptId = `${props.idPrefix}-prompt`;
  const expanded = props.compact ? draft.promptExpanded : true;
  const busy = props.pending !== null;

  const selectedAgent = agents.find((agent) => agent.id === draft.agentId) ?? null;
  const capability = mergeRuntimeDefaults(
    runtimeFor(draft.agentId),
    draft.agentId === null ? undefined : props.agentRuntimeDefaults[draft.agentId],
  );
  const runtimes = runtimeOptions(capability, props.declaredModels);
  const runtimeValue = runtimeKey(draft.modelId, draft.reasoningEffort);

  function changeWorkspace(value: string): void {
    if (value === PICK_FOLDER) {
      props.onPickFolder();
      return;
    }
    if (value === CREATE_WORKSPACE) {
      props.onCreateWorkspace();
      return;
    }
    if (value === CREATE_WORKTREE) {
      props.onCreateWorktree();
      return;
    }
    props.onDraftChange({ ...draft, workspacePath: value });
  }

  function changeAgent(agentId: string): void {
    props.onDraftChange(
      withAgent(
        draft,
        agentId,
        mergeRuntimeDefaults(runtimeFor(agentId), props.agentRuntimeDefaults[agentId]),
      ),
    );
  }

  const workspaceName =
    draft.workspacePath === null ? "Choose a folder" : workspaceLabel(draft.workspacePath);

  return (
    <div class={`nt-composer ${props.compact ? "nt-composer--compact" : ""}`}>
      <div class="nt-composer__prompt-head">
        <label for={promptId}>What do you want the agent to do?</label>
        {props.compact ? (
          <button
            type="button"
            class="nt-text-action"
            onClick={() => props.onDraftChange(withPromptExpanded(draft, !expanded))}
          >
            {expanded ? "Hide prompt" : "Add prompt"}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <textarea
          id={promptId}
          class="nt-composer__textarea"
          rows={props.compact ? 3 : 5}
          value={draft.prompt}
          disabled={busy}
          onInput={(event) => props.onDraftChange(withPrompt(draft, event.currentTarget.value))}
        />
      ) : (
        <button
          type="button"
          class="nt-composer__prompt-collapsed"
          onClick={() => props.onDraftChange(withPromptExpanded(draft, true))}
        >
          Open the agent first and type in its terminal
        </button>
      )}

      <div class="nt-composer__context is-expanded">
        <label class="nt-context-control nt-context-control--workspace">
          <DeckIcon icon={Folder} size={ROW_ICON} />
          <span class="nt-context-control__copy">
            <strong>{workspaceName}</strong>
          </span>
          <DeckIcon icon={CaretDown} size={ROW_ICON} />
          <select
            aria-label="Workspace"
            value={draft.workspacePath ?? ""}
            disabled={busy}
            onChange={(event) => changeWorkspace(event.currentTarget.value)}
          >
            {draft.workspacePath === null ? <option value="">Choose a folder</option> : null}
            {props.recents.map((recent) => (
              <option key={recent.path} value={recent.path}>
                {workspaceLabel(recent.path)}
              </option>
            ))}
            <option value={PICK_FOLDER}>Open folder…</option>
            {props.canCreateWorkspace ? (
              <option value={CREATE_WORKSPACE}>Create workspace…</option>
            ) : null}
            {props.canCreateWorktree ? (
              <option value={CREATE_WORKTREE}>Create worktree…</option>
            ) : null}
          </select>
        </label>

        <label class="nt-context-control nt-context-control--agent">
          {selectedAgent === null ? (
            <span class="nt-agent-mark nt-agent-mark--empty" />
          ) : (
            <AgentMark id={selectedAgent.id} label={selectedAgent.label} />
          )}
          <span class="nt-context-control__copy">
            <strong>{selectedAgent?.label ?? "Choose an agent"}</strong>
          </span>
          <DeckIcon icon={CaretDown} size={ROW_ICON} />
          <select
            aria-label="Agent"
            value={draft.agentId ?? ""}
            disabled={busy || agents.length === 0}
            onChange={(event) => changeAgent(event.currentTarget.value)}
          >
            {draft.agentId === null ? <option value="">Choose an agent</option> : null}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.missing ? `${agent.label} — not installed` : agent.label}
              </option>
            ))}
          </select>
        </label>

        {/* Omitted, never disabled (DL-19.7): an agent whose CLI documents no
            model flag and no effort values has nothing to offer here, and an
            empty control would read as a feature that is broken rather than
            absent. */}
        {runtimes.length > 0 ? (
          <label class="nt-runtime-control">
            <span class="nt-runtime-select">
              <select
                aria-label="Model and effort"
                value={runtimeValue}
                disabled={busy}
                onChange={(event) => {
                  const picked = parseRuntimeKey(event.currentTarget.value);
                  props.onDraftChange(withRuntime(draft, picked.model, picked.effort));
                }}
              >
                {runtimes.some((option) => option.value === runtimeValue) ? null : (
                  <option value={runtimeValue}>Default</option>
                )}
                {runtimes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <DeckIcon icon={CaretDown} size={ROW_ICON} />
            </span>
          </label>
        ) : null}

        <div class="nt-composer__actions">
          {props.onOpenFullComposer !== undefined ? (
            <button
              type="button"
              class="nt-icon-action"
              aria-label="Open full composer"
              onClick={props.onOpenFullComposer}
            >
              <DeckIcon icon={ArrowsOutSimple} size={ROW_ICON} />
            </button>
          ) : (
            <button
              type="button"
              class="nt-secondary-action"
              disabled={busy}
              onClick={props.onOpenAgent}
            >
              Open agent first
            </button>
          )}
          <button
            type="button"
            class="nt-primary-action"
            disabled={busy || props.problem !== null}
            onClick={expanded ? props.onStartTask : props.onOpenAgent}
          >
            {expanded ? "Start task" : "Open agent"}
            <DeckIcon icon={ArrowUp} size={ROW_ICON} />
          </button>
        </div>
      </div>

      {/* One line, and the only place the launcher explains itself. A problem
          the user must act on is an alert; a notice from a finished attempt is
          a status, so it does not interrupt what they are typing. */}
      {props.problem !== null ? (
        <p class="nt-composer__notice" role="alert">
          {problemMessage(props.problem)}
          {props.problem === "no-runnable-agent" || props.problem === "agent-unavailable" ? (
            <button type="button" class="nt-text-action" onClick={props.onManageAgents}>
              Manage agents…
            </button>
          ) : null}
        </p>
      ) : props.notice !== null ? (
        <p class="nt-composer__notice" role="status">
          {props.notice}
        </p>
      ) : null}
    </div>
  );
}
