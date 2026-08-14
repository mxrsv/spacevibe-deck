/**
 * `git worktree add` for the open board's Create Worktree flow (task 16).
 *
 * `electron/worktrees.ts` next door answers "what worktrees does this
 * repository already have" for the navigation rail; this module answers "make
 * a new one." They stay apart for the same reason `git.ts` and `worktrees.ts`
 * do — read and write have different shapes and different callers.
 *
 * Every path is an argv element, never shell text: `execFile` takes an array,
 * so a repo path, branch name or destination the user typed can never be
 * interpreted as shell syntax.
 */
import { execFile, type ExecException } from "node:child_process";

const GIT_TIMEOUT_MS = 4000;
const GIT_MAX_BUFFER = 1024 * 1024;

export interface WorktreeAddParams {
  readonly repoPath: string;
  readonly branch: string;
  readonly destPath: string;
}

export type WorktreeAddErrorCode =
  | "not-a-repository"
  | "branch-exists"
  | "destination-exists"
  | "git-not-found"
  | "unknown";

export type WorktreeAddResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: WorktreeAddErrorCode };

/**
 * Turns one failed `git worktree add` into a closed error code. Order
 * matters: a branch-exists failure also contains the substring "already
 * exists", so it is matched before the more general destination check.
 */
function classify(error: ExecException, stderr: string): WorktreeAddErrorCode {
  if (error.code === "ENOENT") {
    return "git-not-found";
  }
  if (/not a git repository/i.test(stderr)) {
    return "not-a-repository";
  }
  if (/branch named ['"][^'"]*['"] already exists/i.test(stderr)) {
    return "branch-exists";
  }
  if (/already exists/i.test(stderr)) {
    return "destination-exists";
  }
  return "unknown";
}

/**
 * Runs `git -C <repoPath> worktree add <destPath> -b <branch>`.
 *
 * Never rejects and never returns git's own text to the caller (C5/C6): the
 * result is one of a closed set of error codes the form maps to friendly
 * copy, while the stderr that produced it is logged here, main-process side
 * only.
 */
export function addWorktree({
  repoPath,
  branch,
  destPath,
}: WorktreeAddParams): Promise<WorktreeAddResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoPath, "worktree", "add", destPath, "-b", branch],
      {
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (error) {
          const code = classify(error, stderr ?? "");
          console.error(
            `worktree_add failed: git -C ${repoPath} worktree add ${destPath} -b ${branch} →`,
            stderr || error.message,
          );
          resolve({ ok: false, error: code });
          return;
        }
        resolve({ ok: true, path: destPath });
      },
    );
  });
}
