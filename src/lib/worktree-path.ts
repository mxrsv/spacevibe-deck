const TRAILING_SEPARATOR = /[\\/]$/;

// What a path with no separator of its own is joined with: the spelling this
// function always produced before Windows paths were understood.
const DEFAULT_SEPARATOR = "/";

/**
 * The create-worktree form's destination prefill: a suggestion, not a rule
 * (contract 2026-08-14) — the owner's real trees deviate from any fixed
 * convention, so the field stays editable and this only computes the
 * starting value.
 *
 * Either separator is honoured and the suggestion is spelled with the one the
 * repo path uses, so `C:\code\deck` suggests `C:\code\deck-worktrees\<branch>`.
 * The branch keeps its own slashes (git accepts both on Windows). Only unit
 * tests cover the Windows spelling; no Windows device has run this flow.
 */
export function suggestWorktreeDest(repoPath: string, branch: string): string {
  const trimmedBranch = branch.trim();
  if (repoPath === "" || trimmedBranch === "") {
    return "";
  }
  const trimmedRepo =
    TRAILING_SEPARATOR.test(repoPath) && repoPath.length > 1 ? repoPath.slice(0, -1) : repoPath;
  // The cut `baseName` and `parentDirectory` make in `path-name.ts`, mirrored
  // rather than reused: `parentDirectory` answers the path itself when the cut
  // is at or before the start, and here that case needs an empty parent so
  // `/deck` still suggests `/deck-worktrees/…`.
  const cut = Math.max(trimmedRepo.lastIndexOf("/"), trimmedRepo.lastIndexOf("\\"));
  const parent = cut <= 0 ? "" : trimmedRepo.slice(0, cut);
  const repoName = trimmedRepo.slice(cut + 1);
  if (repoName === "") {
    return "";
  }
  const separator = cut === -1 ? DEFAULT_SEPARATOR : trimmedRepo.charAt(cut);
  return `${parent}${separator}${repoName}-worktrees${separator}${trimmedBranch}`;
}
