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

export const quickLaunchOpen = signal(false);

/**
 * Which project the OPEN Quick Launch targets, or null for "wherever the
 * active tab is". Non-null only while the popover was raised from a rail
 * project header (DL-27.18), and cleared on close so a rail launch cannot leak
 * into the next ⌘T — the same discipline `quickPickerWorkspace` needed.
 */
export const quickLaunchWorkspace = signal<string | null>(null);

export function updateDraft(next: NewTaskDraft): void {
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
}

/**
 * Fill the workspace from context — a recents row, a pinned project header, a
 * freshly created folder or worktree.
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

export function openQuickLaunch(workspacePath: string | null): void {
  quickLaunchWorkspace.value = workspacePath;
  if (workspacePath !== null) {
    prefillWorkspace(workspacePath);
  }
  quickLaunchOpen.value = true;
}

export function closeQuickLaunch(): void {
  quickLaunchOpen.value = false;
  quickLaunchWorkspace.value = null;
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
  quickLaunchOpen.value = false;
  quickLaunchWorkspace.value = null;
}
