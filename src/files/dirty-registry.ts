/**
 * The renderer half of the dirty model (plan T9).
 *
 * Dirty state lives in Monaco — in the renderer — while the quit and
 * window-close censuses are computed in the MAIN process, deliberately, so a
 * wedged webview cannot make ⌘Q unanswerable. This registry is the bridge's
 * renderer end: it holds which absolute paths have unsaved edits and pushes the
 * whole set to main on every transition.
 *
 * The invariant that decides every ambiguous case: **an unknown or disagreeing
 * state resolves toward DIRTY**, so the guard asks. Discarding someone's work
 * because a signal was missed is not recoverable; one extra dialog is.
 */

/** `"unknown"` is not a third state to render — it is how a caller says "I
 * cannot read this editor", and it resolves to dirty. */
export type DirtyState = boolean | "unknown";

export interface DirtyRegistry {
  /**
   * Record a path's state. Returns true when the SET changed, which is the
   * signal to push — a clean→clean or dirty→dirty write is not a transition
   * and must not put an IPC message on the wire per keystroke.
   */
  set(path: string, state: DirtyState): boolean;
  /** Forget a path entirely — the tab closed, and the guard has already run. */
  forget(path: string): boolean;
  /** Forget every path outside `live`; a workspace's tabs closing at once. */
  prune(live: readonly string[]): boolean;
  has(path: string): boolean;
  /** The complete set, sorted so the payload is stable across pushes. */
  paths(): string[];
  size(): number;
}

export function createDirtyRegistry(): DirtyRegistry {
  const dirty = new Set<string>();

  function apply(path: string, next: boolean): boolean {
    if (next === dirty.has(path)) {
      return false;
    }
    if (next) {
      dirty.add(path);
    } else {
      dirty.delete(path);
    }
    return true;
  }

  return {
    set(path, state) {
      // The one line the whole module exists for: anything that is not an
      // explicit `false` counts as dirty.
      return apply(path, state !== false);
    },
    forget(path) {
      return dirty.delete(path);
    },
    prune(live) {
      const keep = new Set(live);
      let changed = false;
      for (const path of [...dirty]) {
        if (!keep.has(path)) {
          dirty.delete(path);
          changed = true;
        }
      }
      return changed;
    },
    has(path) {
      return dirty.has(path);
    },
    paths() {
      return [...dirty].sort();
    },
    size() {
      return dirty.size;
    },
  };
}

/**
 * A registry that pushes its whole set to the host whenever it changes.
 *
 * The PAYLOAD is the complete set even though the TRIGGER is a delta — the same
 * discipline `watch_paths` uses in this feature, and for the same reason: a
 * replace is idempotent, so a dropped, duplicated or reordered message cannot
 * leave main believing a saved file is still unsaved. A true incremental delta
 * would make the host's view depend on every message arriving exactly once.
 */
export function createPushingDirtyRegistry(
  push: (paths: readonly string[]) => void,
): DirtyRegistry {
  const registry = createDirtyRegistry();
  const pushIfChanged = (changed: boolean): boolean => {
    if (changed) {
      push(registry.paths());
    }
    return changed;
  };
  return {
    set: (path, state) => pushIfChanged(registry.set(path, state)),
    forget: (path) => pushIfChanged(registry.forget(path)),
    prune: (live) => pushIfChanged(registry.prune(live)),
    has: (path) => registry.has(path),
    paths: () => registry.paths(),
    size: () => registry.size(),
  };
}
