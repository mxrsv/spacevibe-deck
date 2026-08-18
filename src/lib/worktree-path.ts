/**
 * The create-worktree form's destination prefill: a suggestion, not a rule
 * (contract 2026-08-14) — the owner's real trees deviate from any fixed
 * convention, so the field stays editable and this only computes the
 * starting value.
 *
 * POSIX `/`-separated only, matching `folderName` in `workspace-recents.ts`:
 * Windows evidence for this flow is still an open gate (see repo AGENTS.md).
 */
export function suggestWorktreeDest(repoPath: string, branch: string): string {
  const trimmedBranch = branch.trim();
  if (repoPath === '' || trimmedBranch === '') {
    return '';
  }
  const trimmedRepo = repoPath.endsWith('/') && repoPath !== '/' ? repoPath.slice(0, -1) : repoPath;
  const lastSlash = trimmedRepo.lastIndexOf('/');
  const parent = lastSlash <= 0 ? '' : trimmedRepo.slice(0, lastSlash);
  const repoName = trimmedRepo.slice(lastSlash + 1);
  if (repoName === '') {
    return '';
  }
  return `${parent}/${repoName}-worktrees/${trimmedBranch}`;
}
