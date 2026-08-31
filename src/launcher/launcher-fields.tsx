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
  | "selecting-workspace"
  | "creating-workspace"
  | "creating-worktree"
  | "opening-agent"
  | "sending-prompt"
  | "retrying-prompt";

/** User-facing progress copy shared by both launcher surfaces. */
export function launcherPendingLabel(pending: LauncherPending): string {
  switch (pending) {
    case "picking-folder":
      return "Opening folder picker…";
    case "selecting-workspace":
      return "Checking workspace…";
    case "creating-workspace":
      return "Creating workspace…";
    case "creating-worktree":
      return "Creating worktree…";
    case "opening-agent":
      return "Opening agent…";
    case "sending-prompt":
      return "Starting agent and staging task…";
    case "retrying-prompt":
      return "Retrying task delivery…";
  }
}

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
  /** What blocks `Start task` — the full chain, prompt included. */
  readonly problem: DraftProblem | null;
  /**
   * What blocks `Open agent first` / `Open agent` — the same chain WITHOUT the
   * prompt. Its own prop rather than a slice of `problem`, because the two
   * actions ask different questions: opening an agent needs no task, and
   * gating it on `empty-prompt` put a disabled `Open agent` directly under the
   * collapsed panel's own "Open the agent first and type in its terminal".
   */
  readonly openProblem: DraftProblem | null;
  /**
   * Whether agent discovery has ANSWERED yet (`agentsProbed`). False means the
   * probe is still out, so an empty agent list is unknown rather than empty.
   */
  readonly agentsResolved: boolean;
  /** A message the launch attempt produced, or null. */
  readonly notice: string | null;
  /** A failed attempt still targets the same tab and no paste landed. */
  readonly canRetryDelivery: boolean;
  /** The materialized tab for the current attempt still exists. */
  readonly canFocusOpenedAgent: boolean;
  /** A person changed task-bearing fields; contextual defaults alone are false. */
  readonly hasUserDraftContent: boolean;
  onDraftChange(next: NewTaskDraft): void;
  onPickFolder(): void;
  onCreateWorkspace(): void;
  onCreateWorktree(): void;
  onManageAgents(): void;
  onStartTask(): void;
  onOpenAgent(): void;
  onRetryDelivery(): void;
  onFocusOpenedAgent(): void;
  onClearDraft(): void;
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

/**
 * How loudly a standing problem is said.
 *
 * A form that opens by scolding is the defect this splits apart: `no-workspace`
 * and `empty-prompt` are not errors, they are the resting state of a draft
 * nobody has filled in yet, and painting them red under `role="alert"` on an
 * untouched composer spends the alarm before anything happened.
 *
 * - `alert` — the user CANNOT fix it in this composer; the recovery is
 *   `Manage agents…`. This is the only tier that keeps spec §9's `role="alert"`.
 * - `hint` — a field is unanswered and might not be noticed; said quietly, with
 *   no role, so it does not interrupt typing.
 * - `silent` — the surface already says it. The prompt label asks for the task
 *   and the disabled primary says it is not ready; a red line repeating that is
 *   noise. `no-runnable-agent` is silent too until the probe has answered,
 *   because until then Deck has not looked.
 */
export function problemTone(
  problem: DraftProblem | null,
  agentsResolved: boolean,
): "alert" | "hint" | "silent" {
  switch (problem) {
    case null:
      return "silent";
    case "no-runnable-agent":
      return agentsResolved ? "alert" : "silent";
    case "agent-unavailable":
      return "alert";
    case "no-workspace":
    case "no-agent":
      return "hint";
    case "empty-prompt":
      return "silent";
  }
}

export function LauncherFields(props: LauncherFieldsProps) {
  const { draft, agents } = props;
  const promptId = `${props.idPrefix}-prompt`;
  const expanded = props.compact ? draft.promptExpanded : true;
  const busy = props.pending !== null;
  /**
   * The primary button changes ACTION with the prompt section, so it must
   * change GATE with it too: collapsed, it opens an agent and a missing task
   * is not its business.
   */
  const activeProblem = expanded ? props.problem : props.openProblem;
  const tone = problemTone(activeProblem, props.agentsResolved);

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
              disabled={busy}
              onClick={props.onOpenFullComposer}
            >
              <DeckIcon icon={ArrowsOutSimple} size={ROW_ICON} />
            </button>
          ) : (
            <button
              type="button"
              class="nt-secondary-action"
              disabled={busy || props.openProblem !== null}
              onClick={props.onOpenAgent}
            >
              Open agent first
            </button>
          )}
          <button
            type="button"
            class="nt-primary-action"
            disabled={busy || activeProblem !== null}
            onClick={expanded ? props.onStartTask : props.onOpenAgent}
          >
            {props.pending === null
              ? expanded
                ? "Start task"
                : "Open agent"
              : launcherPendingLabel(props.pending)}
            <DeckIcon icon={ArrowUp} size={ROW_ICON} />
          </button>
        </div>
      </div>

      {/* Two different things, so two lines rather than one slot they fight
          over. A PROBLEM is standing and blocks the launch, so it is an alert;
          a NOTICE reports what a finished attempt did, so it is a status and
          does not interrupt typing. Collapsing them into one slot let a
          standing problem swallow "that folder is missing", which is the
          sentence the user actually needed. */}
      {tone === "alert" && activeProblem !== null ? (
        <p class="nt-composer__notice" role="alert">
          {problemMessage(activeProblem)}
          <button type="button" class="nt-text-action" onClick={props.onManageAgents}>
            Manage agents…
          </button>
        </p>
      ) : null}
      {tone === "hint" && activeProblem !== null ? (
        <p class="nt-composer__notice nt-composer__notice--status">
          {problemMessage(activeProblem)}
        </p>
      ) : null}
      {props.pending !== null ? (
        <p class="nt-composer__notice nt-composer__notice--status" role="status">
          {launcherPendingLabel(props.pending)}
        </p>
      ) : null}
      {props.notice !== null ? (
        <p class="nt-composer__notice nt-composer__notice--status" role="status">
          {props.notice}
        </p>
      ) : null}
      {props.canRetryDelivery || props.canFocusOpenedAgent || props.hasUserDraftContent ? (
        <div class="nt-composer__recovery" aria-label="Task draft actions">
          {props.canRetryDelivery ? (
            <button type="button" disabled={busy} onClick={props.onRetryDelivery}>
              Retry delivery
            </button>
          ) : null}
          {props.canFocusOpenedAgent ? (
            <button type="button" disabled={busy} onClick={props.onFocusOpenedAgent}>
              Focus opened agent
            </button>
          ) : null}
          {props.hasUserDraftContent ? (
            <button type="button" disabled={busy} onClick={props.onClearDraft}>
              Clear draft
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
