/**
 * Preview-tab promotion (plan T7, spec §4.1).
 *
 * Clicking a file opens it in the workspace's ONE preview slot, italic in the
 * strip. Clicking another file replaces its contents. Intent promotes it to an
 * ordinary kept tab: a double-click in the tree, or the first edit.
 *
 * Pure list arithmetic — the store applies it, the UI renders the result.
 */

export interface FileTabEntry {
  /** Absolute path; the tab's identity within a workspace. */
  readonly path: string;
  /** True while this is the replaceable preview slot. */
  readonly preview: boolean;
  /**
   * Where this tab sits in the strip's one open order
   * (`lib/open-sequence.ts`), against terminal tabs and the browser chip as
   * well as against the other files (DL-18.6, 2026-08-16).
   *
   * Passed IN rather than taken from the counter here: this module is pure
   * list arithmetic, and it stays that way.
   */
  readonly openedAt: number;
}

/** What opening a file needs beyond the path itself. */
export interface OpenTabOptions {
  /** Order key for the tab if this open creates one (`nextOpenSequence()`). */
  readonly openedAt: number;
  /** Unsaved paths — the preview-replacement safety net below. */
  readonly dirtyPaths?: ReadonlySet<string>;
}

/** The preview tab of a workspace, or null when nothing is previewed. */
export function previewTab(tabs: readonly FileTabEntry[]): FileTabEntry | undefined {
  return tabs.find((tab) => tab.preview);
}

export function hasTab(tabs: readonly FileTabEntry[], path: string): boolean {
  return tabs.some((tab) => tab.path === path);
}

/**
 * Single click in the tree.
 *
 * Already open → the list is untouched (the caller just activates it); a kept
 * tab is never demoted back to a preview. Otherwise the preview slot's contents
 * are replaced in place, so the tab does not jump position under the pointer.
 *
 * `dirtyPaths` is the safety net, not the mechanism: the first edit already
 * promotes, so a dirty preview should not exist. If one somehow does, it is
 * PROMOTED rather than replaced — the spec's "replacing a preview never
 * discards work" then holds by construction instead of by inference, which is
 * the property `preview-slot.test.ts` asserts directly.
 */
export function openPreview(
  tabs: readonly FileTabEntry[],
  path: string,
  options: OpenTabOptions,
): FileTabEntry[] {
  const { openedAt, dirtyPaths = new Set<string>() } = options;
  if (hasTab(tabs, path)) {
    return [...tabs];
  }
  const slot = tabs.findIndex((tab) => tab.preview);
  if (slot === -1) {
    return [...tabs, { path, preview: true, openedAt }];
  }
  if (dirtyPaths.has(tabs[slot].path)) {
    return [
      ...tabs.map((tab) => (tab.preview ? { ...tab, preview: false } : tab)),
      { path, preview: true, openedAt },
    ];
  }
  // Replaced in place, order key included: the slot does not move, and since
  // 2026-08-16 "does not move" also means it keeps its place among the
  // terminal tabs — a fresh key would send the chip to the end of the strip
  // under the pointer, which is the jump this branch exists to prevent.
  const next = [...tabs];
  next[slot] = { path, preview: true, openedAt: tabs[slot].openedAt };
  return next;
}

/** Double-click in the tree, or the first edit. Idempotent for a kept tab. */
export function promoteTab(tabs: readonly FileTabEntry[], path: string): FileTabEntry[] {
  return tabs.map((tab) => (tab.path === path && tab.preview ? { ...tab, preview: false } : tab));
}

/** Open a file as a kept tab outright — the double-click path. */
export function openKept(
  tabs: readonly FileTabEntry[],
  path: string,
  options: OpenTabOptions,
): FileTabEntry[] {
  return promoteTab(openPreview(tabs, path, options), path);
}

export function closeFileTab(tabs: readonly FileTabEntry[], path: string): FileTabEntry[] {
  return tabs.filter((tab) => tab.path !== path);
}

/**
 * Which tab becomes active after `path` closes: the one that took its slot, or
 * the last tab when the closed one was last. Null when nothing is left.
 *
 * Same rule as `activeAfterClose` for terminal tabs (`tab-close.ts`), stated
 * here rather than imported so the file store keeps no dependency on the
 * terminal side of the strip.
 */
export function activeAfterFileClose(
  tabs: readonly FileTabEntry[],
  closing: string,
  active: string | null,
): string | null {
  if (active !== closing) {
    return hasTab(closeFileTab(tabs, closing), active ?? '') ? active : null;
  }
  const index = tabs.findIndex((tab) => tab.path === closing);
  const remaining = closeFileTab(tabs, closing);
  if (remaining.length === 0) {
    return null;
  }
  return remaining[Math.min(index, remaining.length - 1)].path;
}
