/**
 * The new-task draft: the five values spec §1 says a task is made of, plus the
 * one presentation preference Quick Launch remembers. Pure — no signals, no
 * host, no DOM, and no knowledge of the settings store.
 *
 * **Every updater returns a new object (C1).** The draft is read by two
 * surfaces at once and survives subview and Settings round-trips, so an
 * in-place edit would change what a surface is showing without telling it.
 *
 * The validation half answers ONE question — why can this draft not launch —
 * and answers it in structural order, so the user is always told the thing they
 * must decide first rather than the last thing to fail. It is deliberately not
 * a list: the composer has one action row, and two problems stated at once
 * about one button is noise.
 */

import type { AgentRuntimeCapability } from "./runtime-catalog";

export interface NewTaskDraft {
  /** The agent's FIRST PROMPT — not a title, not a shell command (spec §3.1). */
  readonly prompt: string;
  readonly workspacePath: string | null;
  readonly agentId: string | null;
  readonly modelId: string | null;
  readonly reasoningEffort: string | null;
  /** Quick Launch only; the Open Board always shows the composer (spec §4.2). */
  readonly promptExpanded: boolean;
}

export const EMPTY_DRAFT: NewTaskDraft = {
  prompt: "",
  workspacePath: null,
  agentId: null,
  modelId: null,
  reasoningEffort: null,
  promptExpanded: true,
};

export function withPrompt(draft: NewTaskDraft, prompt: string): NewTaskDraft {
  return { ...draft, prompt };
}

export function withWorkspace(draft: NewTaskDraft, path: string | null): NewTaskDraft {
  return { ...draft, workspacePath: path };
}

export function withPromptExpanded(draft: NewTaskDraft, expanded: boolean): NewTaskDraft {
  return { ...draft, promptExpanded: expanded };
}

/**
 * Selecting an agent RESETS the runtime pair to that agent's defaults — spec
 * §3.5: "unsupported values are never carried across agents". A `max` effort
 * chosen for claude cannot survive a move to agy, which documents only
 * low|medium|high, and a model name means nothing outside the CLI that
 * publishes it.
 *
 * `capability` is expected to be pre-merged with the user's stored defaults
 * (`mergeRuntimeDefaults`) by the caller. That merge needs the settings store,
 * which this module deliberately cannot see.
 */
export function withAgent(
  draft: NewTaskDraft,
  agentId: string | null,
  capability: AgentRuntimeCapability | null,
): NewTaskDraft {
  return {
    ...draft,
    agentId,
    modelId: capability?.defaultModel ?? null,
    reasoningEffort: capability?.defaultEffort ?? null,
  };
}

export function withRuntime(
  draft: NewTaskDraft,
  modelId: string | null,
  reasoningEffort: string | null,
): NewTaskDraft {
  return { ...draft, modelId, reasoningEffort };
}

export type DraftProblem =
  "no-runnable-agent" | "no-workspace" | "no-agent" | "agent-unavailable" | "empty-prompt";

export interface DraftContext {
  /** Agent ids that are enabled AND whose binary the probe found. */
  readonly runnableAgentIds: readonly string[];
  /** Enabled but off `$PATH` — spec §7's `Not installed` rows. */
  readonly unavailableAgentIds: readonly string[];
}

/**
 * Structural order, most structural first. `no-runnable-agent` leads because
 * it is the only one the user cannot fix inside the launcher — its recovery is
 * `Manage agents…`, not a different selection.
 */
function structuralProblem(draft: NewTaskDraft, context: DraftContext): DraftProblem | null {
  if (context.runnableAgentIds.length === 0) {
    return "no-runnable-agent";
  }
  if (draft.workspacePath === null) {
    return "no-workspace";
  }
  if (draft.agentId === null) {
    return "no-agent";
  }
  if (!context.runnableAgentIds.includes(draft.agentId)) {
    // Covers both an unavailable agent and one that has since been disabled:
    // either way it cannot launch, and spec §7 forbids falling back to another
    // agent once the user has activated a launch action.
    return "agent-unavailable";
  }
  return null;
}

/** Blocks `Start task`. */
export function startTaskProblem(draft: NewTaskDraft, context: DraftContext): DraftProblem | null {
  const structural = structuralProblem(draft, context);
  if (structural !== null) {
    return structural;
  }
  return draft.prompt.trim() === "" ? "empty-prompt" : null;
}

/** Blocks `Open agent` / `Open agent first` — the same chain without the prompt. */
export function openAgentProblem(draft: NewTaskDraft, context: DraftContext): DraftProblem | null {
  return structuralProblem(draft, context);
}
