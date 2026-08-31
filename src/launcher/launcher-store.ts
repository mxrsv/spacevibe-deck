/**
 * The one new-task draft both launcher surfaces edit, and the Quick Launch
 * open state beside it.
 *
 * Module-level signals (R5), so this is window-scoped by construction — a
 * second Deck window gets its own module instance and its own draft, which is
 * what spec §4.3 means by "window-scoped".
 *
 * `quickLaunchOpen` lives HERE rather than in `chrome/events.ts` even though
 * `agentQuickPickerOpen` lives there, for the reason that file's own comments
 * give: a signal goes there when something outside `App`'s closure has to
 * write it. Quick Launch is raised by `App` and by `tab-manager`'s `newTab()`,
 * and both already import this module for the draft, so splitting the two
 * halves across two files would only make it possible for them to disagree.
 *
 * It is deliberately NOT part of `openOverlayRanks()`. Quick Launch is a
 * pane-level popover anchored to a chrome control, not a surface that covers
 * the terminal grid — the `promptsOpen` genre, not DL §29's modal one (spec
 * §4.2, plan decision T-E).
 */

import { signal } from "@preact/signals";
import { boardOpen } from "../chrome/events";
import { EMPTY_DRAFT, withWorkspace, type NewTaskDraft } from "./new-task-draft";

export const newTaskDraft = signal<NewTaskDraft>(EMPTY_DRAFT);

/** Whether a person has changed task-bearing fields, excluding contextual defaults. */
export const taskDraftTouched = signal(false);

export const quickLaunchOpen = signal(false);

/**
 * Which project the OPEN Quick Launch targets, or null for "wherever the
 * active tab is". Non-null only while the popover was raised from a rail
 * project header (DL-27.18), and cleared on close so a rail launch cannot leak
 * into the next ⌘T — the same discipline `quickPickerWorkspace` needed.
 */
export const quickLaunchWorkspace = signal<string | null>(null);

export interface QuickLaunchRetarget {
  readonly currentPath: string;
  readonly requestedPath: string;
}

/** A contextual project change awaiting an explicit Keep / Move / Clear choice. */
export const quickLaunchRetarget = signal<QuickLaunchRetarget | null>(null);

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
  if (next.workspacePath !== newTaskDraft.value.workspacePath) {
    quickLaunchRetarget.value = null;
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
  quickLaunchRetarget.value = null;
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

export function openQuickLaunch(workspacePath: string | null): void {
  quickLaunchWorkspace.value = workspacePath;
  if (workspacePath === null) {
    quickLaunchRetarget.value = null;
  } else if (newTaskDraft.value.workspacePath === null) {
    prefillWorkspace(workspacePath);
  } else if (newTaskDraft.value.workspacePath === workspacePath) {
    quickLaunchRetarget.value = null;
  } else if (!taskDraftTouched.value) {
    prefillWorkspace(workspacePath);
  } else {
    quickLaunchRetarget.value = {
      currentPath: newTaskDraft.value.workspacePath,
      requestedPath: workspacePath,
    };
  }
  quickLaunchOpen.value = true;
}

/** Keep the draft on its current project and withdraw the contextual move. */
export function keepDraftWorkspace(): void {
  const retarget = quickLaunchRetarget.value;
  if (retarget === null) {
    return;
  }
  quickLaunchWorkspace.value = retarget.currentPath;
  quickLaunchRetarget.value = null;
}

/** Move the intact draft to the project named by the contextual trigger. */
export function moveDraftToRetarget(): void {
  const retarget = quickLaunchRetarget.value;
  if (retarget === null) {
    return;
  }
  newTaskDraft.value = withWorkspace(newTaskDraft.value, retarget.requestedPath);
  quickLaunchWorkspace.value = retarget.requestedPath;
  quickLaunchRetarget.value = null;
}

/** Clear task-specific fields, preserve the presentation preference, and use the new project. */
export function clearDraftAndUseRetarget(): void {
  const retarget = quickLaunchRetarget.value;
  if (retarget === null) {
    return;
  }
  newTaskDraft.value = {
    ...EMPTY_DRAFT,
    workspacePath: retarget.requestedPath,
    promptExpanded: newTaskDraft.value.promptExpanded,
  };
  quickLaunchWorkspace.value = retarget.requestedPath;
  quickLaunchRetarget.value = null;
  taskDraftTouched.value = false;
}

export function closeQuickLaunch(): void {
  quickLaunchOpen.value = false;
  quickLaunchWorkspace.value = null;
  quickLaunchRetarget.value = null;
}

/**
 * The active trigger is a true toggle; a different project trigger retargets
 * the already-open tool instead of making the first project's button close a
 * launcher the user just asked to move elsewhere.
 */
export function toggleQuickLaunch(workspacePath: string | null): void {
  if (quickLaunchOpen.value && quickLaunchWorkspace.value === workspacePath) {
    closeQuickLaunch();
    return;
  }
  openQuickLaunch(workspacePath);
}

/**
 * `Open full composer` (spec §4.2): the whole draft moves to the Open Board.
 * Nothing is copied — both surfaces read the same signal — so this is only the
 * two visibility flips, which is exactly why the draft cannot be lost here.
 */
export function transferToBoard(): void {
  closeQuickLaunch();
  boardOpen.value = true;
}

/** Teardown for tests and for a window's own dispose, like `resetSessionTailStore`. */
export function resetLauncherStore(): void {
  newTaskDraft.value = EMPTY_DRAFT;
  taskDraftTouched.value = false;
  quickLaunchOpen.value = false;
  quickLaunchWorkspace.value = null;
  quickLaunchRetarget.value = null;
}
