/**
 * Repository and worktree enumeration for the navigation rail.
 *
 * No `git status` is run anywhere; every failure is a plain scan, and the
 * rail degrades that path to a plain folder. See `docs/internals/agent-rail.md`
 * (section "Other surfaces in the column").
 *
 * `git.ts` next door answers a different question — what is this pane's cwd
 * on — at a per-pane, per-poll cadence, and its answer is decoration. This
 * module's unit is a REPOSITORY, read on demand, and its answer is navigation.
 * Keeping them apart is what stops a repository-wide scan from landing on the
 * pane info poller.
 *
 * Every path in and out of here is absolute, and nothing reaches a shell:
 * `execFile` takes an argv array, so a workspace path (user data) and a
 * worktree path (git's own output) are arguments, never command text.
 */
import { execFile } from "node:child_process";

/** Seconds git gets before the read is abandoned. Matches `git_branch`. */
const GIT_TIMEOUT_MS = 4000;
/** Porcelain output for hundreds of worktrees is still tens of kilobytes. */
const GIT_MAX_BUFFER = 1024 * 1024;

export interface WorktreeEntry {
  /** Absolute path of the worktree's working directory. */
  readonly path: string;
  /** Commit the worktree is on, or null for a bare entry. */
  readonly head: string | null;
  /** Short branch name, or null when detached or bare. */
  readonly branch: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  /** Lock reason if locked; empty string when locked without one. */
  readonly locked: string | null;
  /** Prune reason if git considers the entry prunable — §5's `missing`. */
  readonly prunable: string | null;
}

export type RepositoryScan =
  | {
      readonly kind: "repository";
      /**
       * The repository's identity: the absolute `--git-common-dir`, which is
       * the SAME string for the main checkout and every linked worktree. The
       * toplevel would make each worktree its own repository, which is the bug
       * the rail exists to remove.
       */
      readonly key: string;
      /** Toplevel of the worktree that was scanned, not of the repository. */
      readonly root: string;
      readonly worktrees: readonly WorktreeEntry[];
    }
  | {
      /**
       * Not a repository, or not readable as one. §1.3: this is closed toward
       * the current product, not toward an error surface — the caller renders
       * a plain folder, which is what Deck shows today anyway.
       */
      readonly kind: "plain";
      readonly reason: string;
    };

/**
 * Run one git command, resolving to null on every failure.
 *
 * There is deliberately no rejection path. A navigation rail that can throw is
 * a navigation rail that can strand the user, and every condition in §1.3's
 * table arrives here as an `Error` that means the same thing to the caller.
 */
function git(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        // No shell, and no inherited stdin: a git that decides to prompt for
        // credentials would otherwise wait forever behind the timeout.
        windowsHide: true,
      },
      (error, stdout) => {
        resolve(error ? null : stdout);
      },
    );
  });
}

/** `refs/heads/feature/x` → `feature/x`; anything else is returned as-is. */
function shortBranch(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * Total by construction: records it does not understand cost a field, never
 * the list. An attribute added by a future git release is ignored rather than
 * fatal, which is the difference between a rail that ages and one that breaks
 * on somebody's `brew upgrade`.
 *
 * Records are separated by blank lines and always open with `worktree <path>`;
 * a stanza without one is discarded rather than merged into its neighbour.
 */
export function parseWorktreePorcelain(stdout: string): readonly WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: {
    path: string;
    head: string | null;
    branch: string | null;
    bare: boolean;
    detached: boolean;
    locked: string | null;
    prunable: string | null;
  } | null = null;

  const flush = (): void => {
    if (current !== null) {
      entries.push({ ...current });
      current = null;
    }
  };

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length === 0) {
      flush();
      continue;
    }
    const space = line.indexOf(" ");
    const keyword = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);

    if (keyword === "worktree") {
      flush();
      if (value.length === 0) {
        continue; // a path-less record identifies nothing
      }
      current = {
        path: value,
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      };
      continue;
    }
    if (current === null) {
      continue; // attribute before any `worktree` line — not ours to attach
    }
    switch (keyword) {
      case "HEAD":
        current.head = value.length > 0 ? value : null;
        break;
      case "branch":
        current.branch = value.length > 0 ? shortBranch(value) : null;
        break;
      case "bare":
        current.bare = true;
        break;
      case "detached":
        current.detached = true;
        break;
      // `locked` and `prunable` may arrive with or without a reason. Empty
      // string means "yes, no reason given" and must stay distinct from null,
      // which means "not locked / not prunable".
      case "locked":
        current.locked = value;
        break;
      case "prunable":
        current.prunable = value;
        break;
      default:
        break; // unknown attribute: ignored, never fatal
    }
  }
  flush();
  return entries;
}

/**
 * Read `--git-common-dir` and `--show-toplevel`, both absolute.
 *
 * `--path-format=absolute` needs git 2.31 (2021). Older git rejects the flag,
 * which lands in the null branch and degrades the path to a plain folder — it
 * cannot produce a wrong answer, only a less informative one.
 */
async function readIdentity(path: string): Promise<{ key: string; root: string } | null> {
  const stdout = await git(path, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
    "--show-toplevel",
  ]);
  if (stdout === null) {
    return null;
  }
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    // A bare repository answers with the common dir and no toplevel. It has no
    // working directory to open, so it is not a workspace this rail can show.
    return null;
  }
  return { key: lines[0], root: lines[1] };
}

/**
 * Scan the repository containing `path`. Never rejects.
 *
 * Two commands, both bounded (§1.2). The cost is proportional to the number of
 * worktrees, not to the size of any of them, because `worktree list` reads
 * `.git/worktrees/*` and never walks a working tree. No `git status` is run
 * here or anywhere in this design — that cost IS proportional to the tree.
 */
export async function scanRepository(path: string): Promise<RepositoryScan> {
  if (path.length === 0) {
    return { kind: "plain", reason: "no path" };
  }
  const identity = await readIdentity(path);
  if (identity === null) {
    return { kind: "plain", reason: "not a git repository" };
  }
  const listed = await git(path, ["worktree", "list", "--porcelain"]);
  if (listed === null) {
    return { kind: "plain", reason: "worktree list unavailable" };
  }
  const worktrees = parseWorktreePorcelain(listed);
  if (worktrees.length === 0) {
    // The parser is total, so an empty result means git answered with
    // something this version does not recognise at all. Degrade, do not guess.
    return { kind: "plain", reason: "no worktrees reported" };
  }
  return { kind: "repository", ...identity, worktrees };
}
