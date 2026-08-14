/**
 * Watching the workspace with Node's built-in `fs.watch` — no dependency
 * (plan T13, spec §5).
 *
 * Three properties carry the design:
 *
 *  - **Non-recursive.** Recursion is what makes watchers expensive, and nothing
 *    here needs it: the scope is the open file tabs plus the directories the
 *    tree currently has expanded.
 *  - **`replace`, not `add`.** One call replaces a window's whole set, so a
 *    collapsed directory cannot leak a watcher no matter how the renderer
 *    sequences its calls.
 *  - **Directories, not files.** An atomic writer — Deck's own save included —
 *    renames a temp file over the target, which destroys the inode a per-file
 *    watcher is holding; the parent directory sees that as a plain event. So a
 *    file's PARENT is watched on its behalf.
 *
 * `fs.watch` is inconsistent across platforms (duplicate events, missed
 * events). The mitigation is a cheap reconcile — re-`stat` open files on window
 * focus and tab activation — not a watcher library. If the manual pass shows
 * that is insufficient, adding one is a fork to raise THEN.
 */
import nodeFs from "node:fs";
import path from "node:path";
import {
  PathOutsideWorkspaceError,
  resolveInsideRoot,
  resolveRoot,
} from "./path-guard";

/**
 * Upper bounds on one window's declared `watch_paths` scope (plan T9).
 *
 * These bound the two INPUT lists independently, not the derived watcher
 * count `replace` actually opens — the renderer's declared "directories
 * expanded" and "files open" counts are what a runaway tree/tab state would
 * inflate, and that is the resource this guards against.
 */
export const MAX_WATCH_DIRECTORIES = 256;
export const MAX_WATCH_FILES = 2048;

export class MalformedWatchScopeError extends Error {
  constructor(message: string) {
    super(`watch_paths: ${message}`);
    this.name = "MalformedWatchScopeError";
  }
}

export class TooManyWatchDirectoriesError extends Error {
  constructor(count: number) {
    super(
      `watch_paths: ${count} directories exceeds the ${MAX_WATCH_DIRECTORIES} limit.`,
    );
    this.name = "TooManyWatchDirectoriesError";
  }
}

export class TooManyWatchFilesError extends Error {
  constructor(count: number) {
    super(`watch_paths: ${count} files exceeds the ${MAX_WATCH_FILES} limit.`);
    this.name = "TooManyWatchFilesError";
  }
}

export interface FileChangeEvent {
  readonly path: string;
  readonly kind: "changed" | "deleted";
  readonly mtimeMs: number | null;
  readonly size: number | null;
}

/** The subset of `node:fs` this module needs — the tests drive a fake. */
export interface WatchFs {
  watch(
    directory: string,
    listener: (event: string, filename: string | null) => void,
  ): { close(): void };
  statSync(target: string): {
    mtimeMs: number;
    size: number;
    isFile(): boolean;
  };
}

const nodeWatchFs: WatchFs = {
  watch: (directory, listener) =>
    nodeFs.watch(directory, { persistent: false }, (event, filename) =>
      listener(event, typeof filename === "string" ? filename : null),
    ),
  statSync: (target) => nodeFs.statSync(target),
};

/** Coalesce window for `fs.watch`'s duplicate events. Short enough to feel
 * instant, long enough that macOS's routine double-fire is one event. */
const COALESCE_MS = 40;

export interface WatchScope {
  readonly root: string;
  /** Directories whose listings are on screen. */
  readonly directories: readonly string[];
  /** Open file tabs — watched through their parent directories. */
  readonly files: readonly string[];
}

export interface WatchRegistry {
  /** Replace one window's whole watch set. Idempotent. */
  replace(label: string, scope: WatchScope): void;
  /** Drop a window's watchers — its renderer is gone. */
  forgetWindow(label: string): void;
  /** Close everything. Process teardown and tests. */
  dispose(): void;
  /** Directories currently watched for a window, sorted. Tests and diagnostics. */
  watchedDirectories(label: string): string[];
}

interface WindowWatch {
  readonly watchers: Map<string, { close(): void }>;
  /** Absolute paths this window is interested in, beyond directory listings. */
  files: Set<string>;
  directories: Set<string>;
  root: string;
  readonly pending: Map<string, ReturnType<typeof setTimeout>>;
}

/**
 * Structural validation ONLY — shape and the two raw-count caps. Whether an
 * entry actually lives inside the workspace is a separate, later question
 * (`replace`'s authorization filter), because that check needs the
 * filesystem and a bad shape should reject before touching it.
 */
function assertWellFormedScope(scope: WatchScope): void {
  if (
    typeof scope.root !== "string" ||
    scope.root.length === 0 ||
    !Array.isArray(scope.directories) ||
    !Array.isArray(scope.files) ||
    scope.directories.some((entry) => typeof entry !== "string") ||
    scope.files.some((entry) => typeof entry !== "string")
  ) {
    throw new MalformedWatchScopeError(
      "root must be a non-empty string, and directories/files must be arrays of strings.",
    );
  }
  // Raw count, duplicates included — see `read.ts`'s `MAX_STAT_PATHS` check
  // for why deduping before the cap would be the wrong bound to enforce.
  if (scope.directories.length > MAX_WATCH_DIRECTORIES) {
    throw new TooManyWatchDirectoriesError(scope.directories.length);
  }
  if (scope.files.length > MAX_WATCH_FILES) {
    throw new TooManyWatchFilesError(scope.files.length);
  }
}

export function createWatchRegistry(
  emit: (label: string, event: FileChangeEvent) => void,
  io: WatchFs = nodeWatchFs,
): WatchRegistry {
  const windows = new Map<string, WindowWatch>();

  function stateFor(label: string, root: string): WindowWatch {
    const existing = windows.get(label);
    if (existing !== undefined) {
      existing.root = root;
      return existing;
    }
    const created: WindowWatch = {
      watchers: new Map(),
      files: new Set(),
      directories: new Set(),
      root,
      pending: new Map(),
    };
    windows.set(label, created);
    return created;
  }

  function flush(label: string, state: WindowWatch, target: string): void {
    state.pending.delete(target);
    // Re-resolved on every event: the path guard is what keeps a directory
    // event for a symlink that now points out of the root from reporting a
    // file the window may not read.
    const resolved = resolveInsideRoot(state.root, target);
    if (resolved === null) {
      emit(label, { path: target, kind: "deleted", mtimeMs: null, size: null });
      return;
    }
    try {
      const stats = io.statSync(resolved);
      emit(label, {
        path: target,
        kind: "changed",
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
    } catch {
      emit(label, { path: target, kind: "deleted", mtimeMs: null, size: null });
    }
  }

  function schedule(label: string, state: WindowWatch, target: string): void {
    const existing = state.pending.get(target);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    state.pending.set(
      target,
      setTimeout(() => flush(label, state, target), COALESCE_MS),
    );
  }

  function onEvent(
    label: string,
    state: WindowWatch,
    directory: string,
    filename: string | null,
  ): void {
    if (filename === null) {
      // The platform did not say which entry moved. Reporting the directory
      // itself lets the renderer reconcile its listing; open files are covered
      // by the focus/activation re-stat.
      schedule(label, state, directory);
      return;
    }
    const target = path.join(directory, filename);
    // Only paths the window is actually showing: an open file, or an entry of
    // a directory whose listing is on screen.
    if (state.files.has(target) || state.directories.has(directory)) {
      schedule(label, state, target);
    }
  }

  return {
    replace(label, scope) {
      assertWellFormedScope(scope);
      const canonicalRoot = resolveRoot(scope.root);
      if (canonicalRoot === null) {
        throw new PathOutsideWorkspaceError(scope.root);
      }
      // Authorization, same rule as every other fs channel: the renderer is
      // not the trust boundary, so a directory/file that does not resolve
      // inside the root is dropped here — BEFORE it ever reaches `io.watch`
      // — rather than trusted because it came back out at event time via
      // `flush`'s own guard. A directory must exist to be watched at all, so
      // it is checked directly; a FILE is checked through its PARENT so a
      // deleted-but-still-open tab (the "Save again" case) keeps its watcher.
      const authorizedDirectories = scope.directories.filter(
        (directory) => resolveInsideRoot(canonicalRoot, directory) !== null,
      );
      const authorizedFiles = scope.files.filter(
        (file) => resolveInsideRoot(canonicalRoot, path.dirname(file)) !== null,
      );
      const state = stateFor(label, canonicalRoot);
      state.files = new Set(authorizedFiles);
      state.directories = new Set(authorizedDirectories);
      // A file is watched through its parent: an atomic save renames over the
      // target, which a per-file watcher would lose track of entirely.
      const wanted = new Set<string>([
        ...authorizedDirectories,
        ...authorizedFiles.map((file) => path.dirname(file)),
      ]);
      for (const [directory, watcher] of state.watchers) {
        if (!wanted.has(directory)) {
          watcher.close();
          state.watchers.delete(directory);
        }
      }
      for (const directory of wanted) {
        if (state.watchers.has(directory)) {
          continue;
        }
        try {
          state.watchers.set(
            directory,
            io.watch(directory, (_event, filename) =>
              onEvent(label, state, directory, filename),
            ),
          );
        } catch {
          // A directory that vanished between the listing and this call. Not
          // watching it is correct; failing the whole replace is not.
        }
      }
    },
    forgetWindow(label) {
      const state = windows.get(label);
      if (state === undefined) {
        return;
      }
      for (const watcher of state.watchers.values()) {
        watcher.close();
      }
      for (const timer of state.pending.values()) {
        clearTimeout(timer);
      }
      windows.delete(label);
    },
    dispose() {
      for (const label of [...windows.keys()]) {
        this.forgetWindow(label);
      }
    },
    watchedDirectories(label) {
      return [...(windows.get(label)?.watchers.keys() ?? [])].sort();
    },
  };
}
