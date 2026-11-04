import { signal } from "@preact/signals";

/**
 * What the stage shows in the launcher's place (spec LCH-8): the Clone and Create workspace forms
 * the Open board held, the Worktree form for a rail that is not on screen, and the session list
 * behind "Resume a session…".
 */
export type StageFormKind = "clone" | "create" | "worktree" | "sessions";

export interface StageForm {
  readonly kind: StageFormKind;
  /** The repository a worktree form starts on; null leaves the field to the user. */
  readonly repoPath: string | null;
}

/**
 * The open form, or null. A module signal, never component state: the File menu's seam is
 * captured once when the window's tab manager is built and must reach the current value.
 */
export const stageForm = signal<StageForm | null>(null);

export function openStageForm(kind: StageFormKind, repoPath: string | null = null): void {
  stageForm.value = { kind, repoPath };
}

export function closeStageForm(): void {
  stageForm.value = null;
}
