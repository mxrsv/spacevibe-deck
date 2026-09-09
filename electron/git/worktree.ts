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
import { lstat } from "node:fs/promises";
import path from "node:path";

const GIT_TIMEOUT_MS = 60_000;
const GIT_INSPECT_TIMEOUT_MS = 10_000;
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
  | "invalid-branch"
  | "invalid-path"
  | "permission-denied"
  | "repository-unavailable"
  | "no-commits"
  | "disk-full"
  | "timed-out"
  | "incomplete-worktree"
  | "recovery-check-failed"
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
  if (
    error.code === "EACCES" ||
    /permission denied|access is denied|operation not permitted/i.test(stderr)
  ) {
    return "permission-denied";
  }
  if (/no space left on device|disk full/i.test(stderr)) {
    return "disk-full";
  }
  if (/cannot change to .*: (no such file or directory|not a directory)/i.test(stderr)) {
    return "repository-unavailable";
  }
  if (/not a git repository/i.test(stderr)) {
    return "not-a-repository";
  }
  if (/not a valid branch name|is not allowed for a branch name/i.test(stderr)) {
    return "invalid-branch";
  }
  if (/invalid reference: HEAD|not a valid object name: ['"]?HEAD/i.test(stderr)) {
    return "no-commits";
  }
  if (/branch named ['"][^'"]*['"] already exists/i.test(stderr)) {
    return "branch-exists";
  }
  if (/already exists/i.test(stderr)) {
    return "destination-exists";
  }
  return "unknown";
}

interface GitResult {
  readonly error: ExecException | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGit(repoPath: string, args: readonly string[], timeout: number): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoPath, ...args],
      {
        encoding: "utf8",
        timeout,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        // Error classification must not depend on the user's Git locale.
        env: { ...process.env, LC_ALL: "C", LANG: "C", GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `worktree_add failed: git -C ${repoPath} ${args.join(" ")} →`,
            stderr || error.message,
            { code: error.code, killed: error.killed, signal: error.signal },
          );
        }
        resolve({ error, stdout, stderr });
      },
    );
  });
}

async function destinationExists(destPath: string): Promise<boolean | null> {
  try {
    await lstat(destPath); // A dangling symlink also occupies the destination.
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    console.error("worktree_add: cannot inspect destination", destPath, error);
    return null;
  }
}

/** Read only. A killed checkout can leave a branch even if Git removed its directory.
 * Never infer success from registration: files or a checkout hook may be incomplete.
 * Never remove, reset, prune or automatically retry a user's checkout. */
async function inspectInterrupted({
  repoPath,
  branch,
  destPath,
}: WorktreeAddParams): Promise<WorktreeAddErrorCode> {
  const ref = `refs/heads/${branch}`;
  const [refs, worktrees, exists] = await Promise.all([
    runGit(repoPath, ["for-each-ref", "--format=%(refname)", ref], GIT_INSPECT_TIMEOUT_MS),
    runGit(repoPath, ["worktree", "list", "--porcelain", "-z"], GIT_INSPECT_TIMEOUT_MS),
    destinationExists(destPath),
  ]);
  if (refs.error || worktrees.error || exists === null) return "recovery-check-failed";
  const hasBranch = refs.stdout.split("\n").includes(ref);
  const registered = worktrees.stdout
    .split("\0")
    .some(
      (field) =>
        field === `branch ${ref}` ||
        (field.startsWith("worktree ") &&
          path.resolve(field.slice("worktree ".length)) === destPath),
    );
  console.error("worktree_add: interrupted checkout state", {
    repoPath,
    branch,
    destPath,
    hasBranch,
    registered,
    exists,
  });
  return hasBranch || registered || exists ? "incomplete-worktree" : "timed-out";
}

/** Closed error codes cross IPC; Git diagnostics stay in main's log.
 * `-b` (never `-B` or `--force`) also protects leftovers on a manual retry. */
export async function addWorktree(params: WorktreeAddParams): Promise<WorktreeAddResult> {
  const { repoPath, branch, destPath } = params;
  if (
    ![repoPath, destPath].every(
      (value) => typeof value === "string" && path.isAbsolute(value) && !value.includes("\0"),
    )
  ) {
    return { ok: false, error: "invalid-path" };
  }
  if (
    typeof branch !== "string" ||
    branch.trim() === "" ||
    branch.startsWith("-") ||
    branch.includes("\0")
  ) {
    return { ok: false, error: "invalid-branch" };
  }
  try {
    const result = await runGit(
      repoPath,
      ["worktree", "add", destPath, "-b", branch],
      GIT_TIMEOUT_MS,
    );
    if (!result.error) return { ok: true, path: destPath };
    if (result.error.killed && result.error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return {
        ok: false,
        error: await inspectInterrupted({ repoPath, branch, destPath: path.resolve(destPath) }),
      };
    }
    return { ok: false, error: classify(result.error, result.stderr) };
  } catch (error) {
    console.error("worktree_add: unexpected failure", error);
    return { ok: false, error: "unknown" };
  }
}
