/**
 * Which folder the dock's Files and Changes sections show (spec OD-3, LAY-6, AC-3).
 *
 * The legacy dock roots them at the selected tab's `workspacePath`, which is fixed when the tab is
 * created. The stacked dock follows the FOCUSED pane: its cwd (`statusInfo.cwd`, which `syncViews`
 * already publishes) mapped to the checkout that contains it by longest prefix, so an agent that
 * `cd`s into a secondary worktree takes the dock with it. This is a derived value and writes
 * nothing: `activeWorkspace` stays the tab's own folder, because the file watcher and the open
 * file tabs key on it.
 *
 * What the user sees while the answer is unknown: the cwd is polled every 2 seconds, so the dock
 * keeps the previous root for up to that long after an agent changes directory. It is null before
 * a pane's first poll, so a new tab's dock starts on the tab's folder and moves only if the pane
 * turns out to stand in another checkout. On Windows the cwd comes only from the OSC 9;9 the
 * injected prompt prints, so a shell that does not print it leaves the dock on the tab's folder.
 */
import { computed } from "@preact/signals";
import { activeWorkspace } from "../../files/file-surface-store";
import { repositoryScans } from "../../repositories/repositories-store";
import { worktreeForPath } from "../../repositories/repository-model";
import { statusInfo, tabViews } from "../../terminal/tabs-store";

export interface DockRootInput {
  /** The focused pane's working directory, or null when it is not known. */
  readonly cwd: string | null;
  /** A file surface holds the keyboard, so there is no focused pane to follow. */
  readonly surfaceFocused: boolean;
  readonly home: string;
  /** Every folder the window knows as a checkout: scanned worktrees and open tabs' folders. */
  readonly checkouts: readonly string[];
  /** The tab's own folder: the answer whenever the cwd says nothing usable. */
  readonly fallback: string | null;
}

/** Whether `path` is `home` or one of its ancestors: a root that would show the whole home. */
function coversHome(path: string, home: string): boolean {
  return (
    home !== "" && (home === path || home.startsWith(`${path}/`) || home.startsWith(`${path}\\`))
  );
}

/**
 * The checkout holding `cwd`, else `fallback`. Never the home directory or a parent of it: a
 * cwd that sits outside every known checkout is not a reason to root the tree there, so it
 * answers the tab's folder (which is whatever the user opened, home included, as before).
 */
export function resolveDockRoot(input: DockRootInput): string | null {
  const { cwd, surfaceFocused, home, checkouts, fallback } = input;
  if (cwd === null || surfaceFocused) {
    return fallback;
  }
  const candidates = checkouts.filter((path) => path !== "" && !coversHome(path, home));
  return worktreeForPath(candidates, cwd) ?? fallback;
}

/** The checkouts the window knows: every scanned worktree, every open tab's folder, the active one. */
function knownCheckouts(): readonly string[] {
  const scanned = [...repositoryScans.value.values()].flatMap((scan) =>
    scan.kind === "repository"
      ? scan.worktrees.filter((worktree) => !worktree.bare).map((worktree) => worktree.path)
      : [],
  );
  const opened = tabViews.value.flatMap((tab) =>
    tab.workspacePath === null ? [] : [tab.workspacePath],
  );
  const active = activeWorkspace.value;
  return active === null ? [...scanned, ...opened] : [...scanned, ...opened, active];
}

/**
 * The dock's root as a signal, so a reader re-renders when the ROOT moves and not on every cwd
 * poll, status change or scan that leaves it where it was.
 */
export const dockRoot = computed(() => {
  const info = statusInfo.value;
  return resolveDockRoot({
    cwd: info.cwd,
    surfaceFocused: info.paneCount === null,
    home: info.home,
    checkouts: knownCheckouts(),
    fallback: activeWorkspace.value,
  });
});

/**
 * The focused pane's working directory, exactly as the shell reports it, or null when it is not
 * known or no pane holds the keyboard (a file surface does). The History section matches sessions
 * on it exactly, where the root takes the checkout containing it.
 */
export const focusedCwd = computed(() => {
  const info = statusInfo.value;
  return info.paneCount === null ? null : info.cwd;
});
