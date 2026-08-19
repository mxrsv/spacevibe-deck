/**
 * The main-process half of the dirty model (plan T15.1).
 *
 * Keyed by WINDOW LABEL and absolute path, so the quit census can name the
 * unsaved files of every window while a window close names only its own — the
 * same split the pane routes already have.
 *
 * Window death clears that window's entries. Without it, a renderer that dies
 * mid-edit leaves main permanently believing a file is unsaved, and ⌘Q asks a
 * question about a window that no longer exists.
 */

/** Upper bound on paths held for one window. A renderer cannot make the main
 * process hold unbounded state; past this the set is truncated, which fails
 * toward asking (the census still reports files) rather than toward silence. */
const MAX_PATHS_PER_WINDOW = 512;

export class MainDirtyRegistry {
  private readonly byWindow = new Map<string, string[]>();

  /**
   * Replace one window's set.
   *
   * A replace, not a merge: the renderer sends its complete set on every
   * transition, so the host's view cannot drift if a message is dropped or
   * arrives twice.
   */
  replace(label: string, paths: readonly unknown[]): void {
    const clean = paths
      .filter((path): path is string => typeof path === "string" && path !== "")
      .slice(0, MAX_PATHS_PER_WINDOW);
    if (clean.length === 0) {
      this.byWindow.delete(label);
      return;
    }
    this.byWindow.set(label, clean);
  }

  /** Drop a window's entries — its renderer is gone. */
  forgetWindow(label: string): void {
    this.byWindow.delete(label);
  }

  /** Unsaved files of one window, in the order the renderer reported them. */
  forWindow(label: string): string[] {
    return [...(this.byWindow.get(label) ?? [])];
  }

  /**
   * Every unsaved file across every window, deduplicated.
   *
   * Deduplicated because the SAME file can be open in two windows (spec §2.2),
   * and one quit dialog naming it twice reads as two different problems.
   */
  all(): string[] {
    const seen = new Set<string>();
    for (const paths of this.byWindow.values()) {
      for (const path of paths) {
        seen.add(path);
      }
    }
    return [...seen];
  }

  /** True when anything anywhere is unsaved — the ⌘Q early-return's question. */
  anyDirty(): boolean {
    for (const paths of this.byWindow.values()) {
      if (paths.length > 0) {
        return true;
      }
    }
    return false;
  }
}
