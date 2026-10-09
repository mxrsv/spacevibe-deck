/**
 * What tells the Changes list to read again (plan 2026-10-10-changes-list, C3).
 *
 * Two watches per window, held only while the list is shown and the window is
 * visible, with Node's built-in `fs.watch` and no library:
 *
 *  - **Recursive on the root**, macOS and Windows only. Linux's implementation
 *    walks every directory, and Deck does not ship there. Under the root's own
 *    `.git/` only `index`, `HEAD`, `packed-refs` and `refs/**` count; `objects/`,
 *    `logs/`, `worktrees/` and `*.lock` are the noise a commit makes.
 *  - **Non-recursive on the git directory** when it lies outside the root. A
 *    linked worktree keeps its index and HEAD in `<repo>/.git/worktrees/<name>`,
 *    which no root watch sees (measured 2026-10-10: a commit there produced zero
 *    events under its root), and Deck opens worktrees as tabs. Only `index` and
 *    `HEAD` count there. Platforms without a recursive watch use it for the
 *    root's own `.git` as well.
 *
 * An event only says "read again": at most one per 100 ms per window, trailing,
 * so a burst of 5,000 writes is one message. Scheduling belongs to the renderer.
 *
 * `git status` is run with `--no-optional-locks` for a reason this module
 * depends on: a plain status rewrites `.git/index`, which this very watch would
 * report, which would read again.
 */
import nodeFs from "node:fs";
import path from "node:path";
import { PathOutsideWorkspaceError, resolveRoot } from "../fs/path-guard";

export const EMIT_INTERVAL_MS = 100;

export interface ChangesWatchFs {
  watch(
    target: string,
    options: { readonly recursive: boolean },
    listener: (event: string, filename: string | null) => void,
    onError: (error: unknown) => void,
  ): { close(): void };
}

const nodeChangesFs: ChangesWatchFs = {
  watch(target, options, listener, onError) {
    const watcher = nodeFs.watch(
      target,
      { persistent: false, recursive: options.recursive },
      (event, filename) => listener(event, typeof filename === "string" ? filename : null),
    );
    // EMFILE and ENOSPC can arrive as an event on the watcher after it was
    // created, not as a throw from `watch`.
    watcher.on("error", onError);
    return watcher;
  },
};

export interface ChangesWatchOptions {
  readonly emit: (sender: number, root: string) => void;
  readonly io?: ChangesWatchFs;
  /** Recursive watching exists here. Defaults to macOS and Windows. */
  readonly recursive?: boolean;
  readonly log?: (message: string) => void;
}

export interface ChangesWatchRegistry {
  /** Replace one sender's watched checkout; `null` releases. Throws
   * `PathOutsideWorkspaceError` for a root that does not resolve. */
  replace(sender: number, root: string | null): void;
  release(sender: number): void;
  dispose(): void;
  /** Directories currently watched for a sender, sorted. Tests and diagnostics. */
  watched(sender: number): string[];
}

interface SenderWatch {
  readonly closers: Array<() => void>;
  readonly directories: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Whether a path under the root's `.git/` can change what status says. */
export function keepsRootGitPath(inside: readonly string[]): boolean {
  if (inside.length === 0) {
    // The `.git` entry itself.
    return false;
  }
  const [first, ...rest] = inside;
  if (rest.length === 0) {
    return first === "index" || first === "HEAD" || first === "packed-refs";
  }
  return first === "refs" && !inside[inside.length - 1].endsWith(".lock");
}

/** The git directory that governs `root`: its own `.git`, or the nearest
 * ancestor's, following a linked worktree's `gitdir:` pointer. */
export function findGitDir(root: string): string | null {
  let directory = root;
  for (;;) {
    const candidate = path.join(directory, ".git");
    try {
      const info = nodeFs.statSync(candidate);
      if (info.isDirectory()) {
        return candidate;
      }
      const pointer = /^gitdir:\s*(.+)\s*$/m.exec(nodeFs.readFileSync(candidate, "utf8"));
      if (pointer !== null) {
        return path.resolve(directory, pointer[1]);
      }
      return null;
    } catch {
      // No `.git` here; keep walking up.
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function createChangesWatchRegistry(options: ChangesWatchOptions): ChangesWatchRegistry {
  const io = options.io ?? nodeChangesFs;
  const recursive =
    options.recursive ?? (process.platform === "darwin" || process.platform === "win32");
  const log = options.log ?? ((message: string) => console.warn(message));
  const senders = new Map<number, SenderWatch>();
  const logged = new Set<string>();

  const logOnce = (key: string, message: string) => {
    if (!logged.has(key)) {
      logged.add(key);
      log(message);
    }
  };

  function closeSender(sender: number): void {
    const state = senders.get(sender);
    if (state === undefined) {
      return;
    }
    senders.delete(sender);
    if (state.timer !== null) {
      clearTimeout(state.timer);
    }
    for (const close of state.closers) {
      try {
        close();
      } catch {
        // Already closed by the platform.
      }
    }
  }

  return {
    replace(sender, root) {
      closeSender(sender);
      if (root === null) {
        return;
      }
      const canonical = resolveRoot(root);
      if (canonical === null) {
        throw new PathOutsideWorkspaceError(root);
      }
      const state: SenderWatch = { closers: [], directories: [], timer: null };
      senders.set(sender, state);

      const touch = () => {
        if (state.timer !== null) {
          return;
        }
        state.timer = setTimeout(() => {
          state.timer = null;
          if (senders.get(sender) === state) {
            options.emit(sender, root);
          }
        }, EMIT_INTERVAL_MS);
      };

      const open = (
        target: string,
        isRecursive: boolean,
        keeps: (inside: readonly string[]) => boolean,
      ) => {
        try {
          const watcher = io.watch(
            target,
            { recursive: isRecursive },
            (_event, filename) => {
              // A platform that cannot say what moved counts as a change.
              if (filename === null) {
                touch();
                return;
              }
              const inside = filename.split(/[\\/]+/).filter((part) => part.length > 0);
              if (keeps(inside)) {
                touch();
              }
            },
            (error) => logOnce(target, `changes watch on ${target} failed: ${String(error)}`),
          );
          state.closers.push(() => watcher.close());
          state.directories.push(target);
        } catch (error) {
          // EMFILE, ENOSPC, a vanished root: no watch is the correct degradation.
          // Focus, turn end and Refresh still read.
          logOnce(target, `changes watch on ${target} unavailable: ${String(error)}`);
        }
      };

      const gitDir = findGitDir(canonical);
      const gitInsideRoot = gitDir !== null && isInside(canonical, gitDir);
      if (recursive) {
        open(canonical, true, (inside) => {
          if (inside[0] === ".git") {
            return keepsRootGitPath(inside.slice(1));
          }
          return true;
        });
      }
      if (gitDir !== null && (!gitInsideRoot || !recursive)) {
        open(
          gitDir,
          false,
          (inside) => inside.length === 1 && (inside[0] === "index" || inside[0] === "HEAD"),
        );
      }
    },
    release(sender) {
      closeSender(sender);
    },
    dispose() {
      for (const sender of [...senders.keys()]) {
        closeSender(sender);
      }
    },
    watched(sender) {
      return [...(senders.get(sender)?.directories ?? [])].sort();
    },
  };
}
