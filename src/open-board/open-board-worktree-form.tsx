import { ArrowLeft, FolderOpen } from '@phosphor-icons/react';
import { DeckIcon, ROW_ICON } from '../ui/controls/deck-icon';
import { folderName } from '../lib/workspace-recents';
import type { RecentWorkspace } from '../lib/workspace-recents';
import { tildify } from '../lib/process-info';
import type { WorktreeAddErrorCode } from '../host/worktree-host';

/** C5/C6: friendly copy for the form; the git text that produced each code
 * is logged main-process side only (`electron/git/worktree.ts`), never sent
 * over IPC. */
const ERROR_COPY: Record<WorktreeAddErrorCode, string> = {
  'not-a-repository': "That folder isn't a git repository",
  'branch-exists': 'A branch with that name already exists',
  'destination-exists': 'That destination folder already exists',
  'git-not-found': "git isn't installed, or isn't on PATH",
  unknown: "Couldn't create the worktree — check the folder and branch and try again",
};

export function worktreeErrorCopy(code: WorktreeAddErrorCode): string {
  return ERROR_COPY[code];
}

export interface OpenBoardWorktreeFormProps {
  readonly recents: readonly RecentWorkspace[];
  readonly homeDir: string;
  readonly repoPath: string;
  readonly branch: string;
  readonly destPath: string;
  readonly error: WorktreeAddErrorCode | null;
  readonly creating: boolean;
  onRepoChange(path: string): void;
  onBrowseRepo(): void;
  onBranchChange(branch: string): void;
  onDestChange(path: string): void;
  onBack(): void;
  onSubmit(): void;
}

/**
 * Create-worktree view (task 16): repo picker (recents dropdown + browse),
 * branch name, and a visible, editable destination path. Reached from the
 * home view's "Create worktree" button, gated behind `worktree-host`'s
 * `available`.
 */
export function OpenBoardWorktreeForm({
  recents,
  homeDir,
  repoPath,
  branch,
  destPath,
  error,
  creating,
  onRepoChange,
  onBrowseRepo,
  onBranchChange,
  onDestChange,
  onBack,
  onSubmit,
}: OpenBoardWorktreeFormProps) {
  const canSubmit = repoPath !== '' && branch.trim() !== '' && destPath.trim() !== '' && !creating;

  /** Enter submits, Escape backs out — scoped here rather than left to the
   * board's own key handler, which ignores input targets. */
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    }
  }

  return (
    <div class="board-worktree" onKeyDown={handleKeyDown}>
      <div class="board-worktree__scroll">
        <button class="board-back" onClick={onBack}>
          <DeckIcon icon={ArrowLeft} size={ROW_ICON} />
          Back
        </button>

        <div class="wshead">
          <h1 class="wshead__title">Create worktree</h1>
          <div class="wshead__path">
            A new branch, checked out in its own folder next to the repo
          </div>
        </div>

        <div class="wtf__field">
          <label class="wtf__label" for="wtf-repo">
            Repository
          </label>
          <div class="wtf__row">
            <select
              id="wtf-repo"
              class="wtf__select"
              value={repoPath}
              onChange={(event) => onRepoChange((event.target as HTMLSelectElement).value)}
            >
              <option value="">Select a repository…</option>
              {recents.map((recent) => (
                <option key={recent.path} value={recent.path}>
                  {folderName(recent.path)} —{' '}
                  {homeDir === '' ? recent.path : tildify(recent.path, homeDir)}
                </option>
              ))}
            </select>
            <button class="wtf__browse" onClick={onBrowseRepo}>
              <DeckIcon icon={FolderOpen} size={ROW_ICON} />
              Browse…
            </button>
          </div>
        </div>

        <div class="wtf__field">
          <label class="wtf__label" for="wtf-branch">
            Branch name
          </label>
          <input
            id="wtf-branch"
            class="wtf__input"
            value={branch}
            placeholder="feature/my-branch"
            onInput={(event) => onBranchChange((event.target as HTMLInputElement).value)}
          />
        </div>

        <div class="wtf__field">
          <label class="wtf__label" for="wtf-dest">
            Destination
          </label>
          <input
            id="wtf-dest"
            class="wtf__input"
            value={destPath}
            onInput={(event) => onDestChange((event.target as HTMLInputElement).value)}
          />
        </div>

        {error !== null ? (
          <div class="wtf__error" role="status">
            {worktreeErrorCopy(error)}
          </div>
        ) : null}
      </div>

      <footer class="foot">
        <div class="foot__act">
          <button class="btn" onClick={onBack}>
            Back
          </button>
          <button class="btn btn--primary" disabled={!canSubmit} onClick={onSubmit}>
            {creating ? 'Creating…' : 'Create worktree'}
          </button>
        </div>
      </footer>
    </div>
  );
}
