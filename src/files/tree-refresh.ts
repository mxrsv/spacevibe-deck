/**
 * Coalescer for `fs:changed` bursts that should re-`listDir` the tree.
 *
 * Split out of `file-surface-controller.ts`, which stays the owner of the
 * watcher/document wiring; this module only decides WHICH directories a burst
 * of change events should refresh, and WHEN, so a `git checkout` or an agent
 * writing several files collapses into one `listDir` per affected directory.
 * `loadListing` and the disposed flag are injected because both live in the
 * controller's closure — this module owns no filesystem access of its own.
 */
import { fileSurfaces, visibleDirectories } from "./file-surface-store";

/**
 * Coalesce window for `fs:changed` bursts before the tree re-`listDir`s.
 *
 * The host already debounces `fs.watch`'s own duplicate events (`COALESCE_MS`
 * in `electron/fs/watch.ts`); this is a SEPARATE window on the renderer side,
 * because one filesystem operation on this side of the IPC boundary — an
 * agent writing several files, a `git checkout` — still arrives as several
 * distinct `fs:changed` events. Long enough that a burst collapses into one
 * `listDir` per affected directory, short enough that the tree still reads as
 * live.
 */
const TREE_REFRESH_COALESCE_MS = 100;

/** Split an absolute path into its parent directory. Paths in this module are
 * opaque strings from the host — never parsed with `node:path`, which is not
 * available to the renderer (spec: renderer stays host-free). */
function parentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index <= 0 ? path : path.slice(0, index);
}

export interface TreeRefreshDeps {
  /** Re-`listDir` one directory and apply the result to the store. */
  readonly loadListing: (
    workspacePath: string,
    directory: string,
  ) => Promise<void>;
  /** Whether the owning controller has already disposed. */
  readonly isDisposed: () => boolean;
}

export interface TreeRefresh {
  /**
   * Route one `fs:changed` path to whichever workspace's tree it belongs to.
   *
   * A changed path is reported as the entry itself (a file, or a directory
   * whose OWN watcher fired), so both the entry's parent AND the entry itself
   * are candidate branches: the parent covers "a file appeared/vanished/
   * changed inside a listed directory", the entry itself covers "a listed
   * directory was renamed or deleted out from under its own row". Only a
   * directory the tree currently shows (`visibleDirectories`) schedules a
   * refresh — a change outside every expanded branch is not this window's
   * concern (the focus/activation re-`stat` and the next `listDir` on
   * re-expand are what pick it up instead).
   */
  handleTreeChange(changedPath: string): void;
  /** Cancel every pending flush timer and drop pending state. */
  dispose(): void;
}

export function createTreeRefresh(deps: TreeRefreshDeps): TreeRefresh {
  // Directories an `fs:changed` burst wants re-listed, per workspace, and the
  // one pending flush timer per workspace that will do it.
  const pendingTreeRefresh = new Map<string, Set<string>>();
  const treeRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Flush one workspace's pending directories through `loadListing`, once
   * the coalesce window has closed. */
  function flushTreeRefresh(workspacePath: string): void {
    treeRefreshTimers.delete(workspacePath);
    const directories = pendingTreeRefresh.get(workspacePath);
    pendingTreeRefresh.delete(workspacePath);
    if (deps.isDisposed() || directories === undefined) {
      return;
    }
    for (const directory of directories) {
      void deps.loadListing(workspacePath, directory);
    }
  }

  /** Add one directory to a workspace's pending burst. The first call in a
   * burst arms the timer; later calls just grow the set it will flush. */
  function scheduleTreeRefresh(workspacePath: string, directory: string): void {
    const pending = pendingTreeRefresh.get(workspacePath) ?? new Set<string>();
    pending.add(directory);
    pendingTreeRefresh.set(workspacePath, pending);
    if (treeRefreshTimers.has(workspacePath)) {
      return;
    }
    treeRefreshTimers.set(
      workspacePath,
      setTimeout(
        () => flushTreeRefresh(workspacePath),
        TREE_REFRESH_COALESCE_MS,
      ),
    );
  }

  return {
    handleTreeChange(changedPath) {
      const parent = parentDirectory(changedPath);
      for (const workspacePath of fileSurfaces.value.keys()) {
        const visible = visibleDirectories(workspacePath);
        if (visible.includes(parent)) {
          scheduleTreeRefresh(workspacePath, parent);
        }
        if (changedPath !== parent && visible.includes(changedPath)) {
          scheduleTreeRefresh(workspacePath, changedPath);
        }
      }
    },
    dispose() {
      for (const timer of treeRefreshTimers.values()) {
        clearTimeout(timer);
      }
      treeRefreshTimers.clear();
      pendingTreeRefresh.clear();
    },
  };
}
