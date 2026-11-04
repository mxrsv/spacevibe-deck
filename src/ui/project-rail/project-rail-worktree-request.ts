import { signal } from "@preact/signals";

export interface WorktreeFormRequest {
  readonly id: number;
  /** The repository the form starts on; null keeps the rail's own choice. */
  readonly repoPath: string | null;
}

/**
 * A surface outside the rail (the launcher's project menu) asking the rail to open its Worktree
 * form. The rail's controls own the form and its popover, so this is the one way in; they clear
 * the request once they have opened it.
 */
export const worktreeFormRequest = signal<WorktreeFormRequest | null>(null);

let nextId = 0;

export function requestWorktreeForm(repoPath: string | null): void {
  nextId += 1;
  worktreeFormRequest.value = { id: nextId, repoPath };
}
