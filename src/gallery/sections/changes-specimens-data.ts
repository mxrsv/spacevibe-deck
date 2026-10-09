/**
 * Fake data for the `changes-specimens` section (plan 2026-10-10-changes-list,
 * Task 0). Nothing here reaches a host: the specimens only draw it.
 */

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface ChangeEntry {
  readonly name: string;
  readonly dir: string;
  readonly status: ChangeStatus;
  /** `null` for a binary file, which says so instead of counting. */
  readonly added: number | null;
  readonly removed: number | null;
  readonly oldPath?: string;
}

export const BRANCH = "feat/changes-list";
export const COMPARISON = "uncommitted changes against HEAD";

export const ENTRIES: readonly ChangeEntry[] = [
  { name: "changes.ts", dir: "electron/git", status: "added", added: 214, removed: 0 },
  { name: "channels.ts", dir: "electron/ipc", status: "modified", added: 9, removed: 1 },
  { name: "explorer-tab.tsx", dir: "src/files/ui", status: "modified", added: 18, removed: 4 },
  { name: "file-surface.md", dir: "docs/internals", status: "modified", added: 11, removed: 2 },
  {
    name: "changes-scheduler.ts",
    dir: "src/files/changes",
    status: "renamed",
    added: 6,
    removed: 3,
    oldPath: "src/files/changes/scheduler.ts",
  },
  { name: "legacy-status.ts", dir: "electron/git", status: "deleted", added: 0, removed: 37 },
  { name: "scratch-notes.md", dir: "docs", status: "untracked", added: 12, removed: 0 },
  { name: "empty-state.png", dir: "src/assets", status: "added", added: null, removed: null },
];

export const TOTALS = ENTRIES.reduce(
  (sum, entry) => ({
    added: sum.added + (entry.added ?? 0),
    removed: sum.removed + (entry.removed ?? 0),
  }),
  { added: 0, removed: 0 },
);

export const STATUS_MARK: Readonly<Record<ChangeStatus, string>> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export const STATUS_WORD: Readonly<Record<ChangeStatus, string>> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "Untracked",
};

export const ERROR_LINE = "git status timed out after 10 s. Showing the last list.";
