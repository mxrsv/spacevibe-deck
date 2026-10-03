import { isWindowsPath } from "./path-name";

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
 * A repo path spelled like a Windows one (`isWindowsPath`) is cut at either
 * separator and the suggestion uses the one the path uses, so `C:\code\deck`
 * suggests `C:\code\deck-worktrees\<branch>`. The branch keeps its own slashes
 * (git accepts both on Windows). Every other path is `/`-only, because a
 * backslash is a legal filename character on macOS and Linux and must stay
 * part of the folder name there. Only unit tests cover the Windows spelling;
 * no Windows device has run this flow.
 */
export function suggestWorktreeDest(repoPath: string, branch: string): string {
  const trimmedBranch = branch.trim();
  if (repoPath === "" || trimmedBranch === "") {
    return "";
  }
  return isWindowsPath(repoPath)
    ? windowsDest(repoPath, trimmedBranch)
    : posixDest(repoPath, trimmedBranch);
}

function posixDest(repoPath: string, trimmedBranch: string): string {
  const trimmedRepo = repoPath.endsWith("/") && repoPath !== "/" ? repoPath.slice(0, -1) : repoPath;
  const lastSlash = trimmedRepo.lastIndexOf("/");
  const parent = lastSlash <= 0 ? "" : trimmedRepo.slice(0, lastSlash);
  const repoName = trimmedRepo.slice(lastSlash + 1);
  if (repoName === "") {
    return "";
  }
  return `${parent}/${repoName}-worktrees/${trimmedBranch}`;
}

function windowsDest(repoPath: string, trimmedBranch: string): string {
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
