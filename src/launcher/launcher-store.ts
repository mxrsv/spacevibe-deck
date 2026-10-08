/**
 * The one new-task draft the Open Board edits.
 *
 * Module-level signals (R5), so this is window-scoped by construction — a
 * second Deck window gets its own module instance and its own draft, which is
 * what spec §4.3 means by "window-scoped".
 */

import { signal } from "@preact/signals";
import { boardOpen } from "../chrome/events";
import { EMPTY_DRAFT, withWorkspace, type NewTaskDraft } from "./new-task-draft";

export const newTaskDraft = signal<NewTaskDraft>(EMPTY_DRAFT);

/** Whether a person has changed task-bearing fields, excluding contextual defaults. */
export const taskDraftTouched = signal(false);

function taskFieldsChanged(current: NewTaskDraft, next: NewTaskDraft): boolean {
  return (
    current.prompt !== next.prompt ||
    current.workspacePath !== next.workspacePath ||
    current.agentId !== next.agentId ||
    current.modelId !== next.modelId ||
    current.reasoningEffort !== next.reasoningEffort
  );
}

export function updateDraft(next: NewTaskDraft): void {
  if (taskFieldsChanged(newTaskDraft.value, next)) {
    taskDraftTouched.value = true;
  }
  newTaskDraft.value = next;
}

/**
 * Spec §4.3: only `Clear` or a successful launch resets the draft.
 *
 * `promptExpanded` survives on purpose — it is a remembered PREFERENCE about
 * the surface (spec §4.2), not a value the user is drafting, so clearing the
 * task must not silently re-open a section they collapsed.
 */
export function clearDraft(): void {
  newTaskDraft.value = { ...EMPTY_DRAFT, promptExpanded: newTaskDraft.value.promptExpanded };
  taskDraftTouched.value = false;
}

/**
 * Fill the workspace from context — the active tab, newest live recent, or a
 * pinned project header.
 *
 * `seedAgentId` is that workspace's remembered agent, already resolved against
 * the runnable list by the caller. It is applied ONLY while the draft has no
 * agent, because spec §4.1 says selecting a workspace "does not silently
 * overwrite an explicit agent selection" — once the user has pressed an agent,
 * moving between workspaces must not move it back.
 */
export function prefillWorkspace(path: string | null, seedAgentId?: string | null): void {
  const draft = withWorkspace(newTaskDraft.value, path);
  newTaskDraft.value =
    draft.agentId === null && seedAgentId !== undefined && seedAgentId !== null
      ? { ...draft, agentId: seedAgentId }
      : draft;
}

/** A workspace a person explicitly picked or created, rather than contextual prefill. */
export function selectDraftWorkspace(path: string, seedAgentId?: string | null): void {
  prefillWorkspace(path, seedAgentId);
  taskDraftTouched.value = true;
}

/** Show the Open Board over the stage; the draft is shared, so nothing is copied. */
export function transferToBoard(): void {
  boardOpen.value = true;
}

/** Teardown for tests and for a window's own dispose, like `resetSessionTailStore`. */
export function resetLauncherStore(): void {
  newTaskDraft.value = EMPTY_DRAFT;
  taskDraftTouched.value = false;
}
