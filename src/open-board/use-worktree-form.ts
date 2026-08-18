/**
 * Create-worktree form state (task 16), split out of `open-board.tsx` for
 * F8 — the board file was already at its split threshold before this task's
 * fields and handlers landed on top of it.
 */
import { useSignal } from '@preact/signals';
import { open } from '../host/dialog-host';
import { addWorktree, type WorktreeAddErrorCode } from '../host/worktree-host';
import { suggestWorktreeDest } from '../lib/worktree-path';

export interface WorktreeFormState {
  readonly repoPath: string;
  readonly branch: string;
  readonly destPath: string;
  readonly error: WorktreeAddErrorCode | null;
  readonly creating: boolean;
}

export interface UseWorktreeForm {
  readonly state: WorktreeFormState;
  /** Fresh state every time the form is opened — never a stale attempt. */
  reset(): void;
  setRepo(path: string): void;
  setBranch(branch: string): void;
  /** Marks the destination as user-edited — stops the prefill from
   * overwriting it (contract 2026-08-14: the prefill is a suggestion). */
  setDest(path: string): void;
  browseRepo(): Promise<void>;
  /** Resolves once; calls `onSuccess` with the new worktree's path only when
   * `addWorktree` reports `ok`, and never throws — a failure lands in
   * `state.error` for the caller to render. */
  submit(onSuccess: (path: string) => void): Promise<void>;
}

export function useWorktreeForm(): UseWorktreeForm {
  const repoPath = useSignal('');
  const branch = useSignal('');
  const dest = useSignal('');
  // True once the user has typed in the destination field directly — stops
  // the repo/branch-driven prefill from clobbering a deliberate edit.
  const destTouched = useSignal(false);
  const error = useSignal<WorktreeAddErrorCode | null>(null);
  const creating = useSignal(false);

  function applySuggestion(): void {
    if (!destTouched.value) {
      dest.value = suggestWorktreeDest(repoPath.value, branch.value);
    }
  }

  function reset(): void {
    repoPath.value = '';
    branch.value = '';
    dest.value = '';
    destTouched.value = false;
    error.value = null;
    creating.value = false;
  }

  function setRepo(path: string): void {
    repoPath.value = path;
    error.value = null;
    applySuggestion();
  }

  function setBranch(next: string): void {
    branch.value = next;
    error.value = null;
    applySuggestion();
  }

  function setDest(path: string): void {
    dest.value = path;
    destTouched.value = true;
    error.value = null;
  }

  async function browseRepo(): Promise<void> {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === 'string') {
        setRepo(picked);
      }
    } catch (err: unknown) {
      console.warn('Folder picker failed:', err);
    }
  }

  async function submit(onSuccess: (path: string) => void): Promise<void> {
    if (creating.value) {
      return;
    }
    const repo = repoPath.value;
    const branchName = branch.value.trim();
    const destPath = dest.value.trim();
    if (repo === '' || branchName === '' || destPath === '') {
      return;
    }
    creating.value = true;
    error.value = null;
    const result = await addWorktree({
      repoPath: repo,
      branch: branchName,
      destPath,
    });
    creating.value = false;
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    onSuccess(result.path);
  }

  return {
    state: {
      repoPath: repoPath.value,
      branch: branch.value,
      destPath: dest.value,
      error: error.value,
      creating: creating.value,
    },
    reset,
    setRepo,
    setBranch,
    setDest,
    browseRepo,
    submit,
  };
}
