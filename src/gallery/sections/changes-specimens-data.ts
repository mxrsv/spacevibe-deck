/**
 * Fake data for the `changes-specimens` section, and nothing else.
 *
 * One checkout on `feat/changes-list` with the eight entries CHG1 names: three
 * modified, one added, one renamed with its old path, one deleted, one
 * untracked and one binary. The totals are the sum of the rows below (binary
 * counts nothing), so a variant that prints them can never disagree with the
 * list beside it.
 */
import type { FileClient } from "../../files/file-client";
import { setListing, toggleDirectory } from "../../files/file-surface-store";
import type { DirEntry } from "../../files/file-tree";

export const ROOT = "/Users/deck/spacevibe-deck-worktrees/changes-list";
export const BRANCH = "feat/changes-list";
/** What the comparison is, in the words a tooltip uses (CHG1). */
export const COMPARISON = "Uncommitted changes against HEAD";

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "binary";

export interface ChangeEntry {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly added: number;
  readonly removed: number;
  /** Set for a rename only. */
  readonly oldPath?: string;
}

/** Path order, as `git status` prints them. */
export const CHANGES: readonly ChangeEntry[] = [
  { path: "build/icon.png", status: "binary", added: 0, removed: 0 },
  { path: "electron/git/changes.ts", status: "added", added: 11, removed: 0 },
  { path: "electron/ipc/channels.ts", status: "modified", added: 4, removed: 0 },
  { path: "scripts/electron-ipc-contract.test.ts", status: "modified", added: 6, removed: 1 },
  { path: "src/files/changes/changes-list.tsx", status: "untracked", added: 7, removed: 0 },
  { path: "src/files/legacy-status.ts", status: "deleted", added: 0, removed: 2 },
  { path: "src/files/ui/explorer-tab.tsx", status: "modified", added: 12, removed: 3 },
  {
    path: "src/host/git-changes-host.ts",
    status: "renamed",
    added: 2,
    removed: 1,
    oldPath: "src/host/git-host.ts",
  },
];

export interface Totals {
  readonly added: number;
  readonly removed: number;
}

export const TOTALS: Totals = CHANGES.reduce<Totals>(
  (sum, entry) => ({ added: sum.added + entry.added, removed: sum.removed + entry.removed }),
  { added: 0, removed: 0 },
);

/** The word a tooltip says for each status; the row itself draws a one-letter mark. */
export const STATUS_WORD: Readonly<Record<ChangeStatus, string>> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "Untracked",
  binary: "Modified, binary",
};

/** Git's own letters, `U` for untracked (VS Code's, since `?` reads as a missing icon). */
export const STATUS_MARK: Readonly<Record<ChangeStatus, string>> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  binary: "M",
};

export const splitPath = (path: string): { readonly name: string; readonly dir: string } => {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { name: path, dir: "" }
    : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
};

export function changeTooltip(entry: ChangeEntry): string {
  const lines = [`${STATUS_WORD[entry.status]} · ${entry.path}`];
  if (entry.oldPath !== undefined) {
    lines.push(`from ${entry.oldPath}`);
  }
  return lines.join("\n");
}

/* ── the tree variant C filters ─────────────────────────────────── */

export interface TreeNode {
  readonly path: string;
  readonly directory: boolean;
}

/** The checkout's whole tree, every folder open. Variant C prunes it. */
export const TREE: readonly TreeNode[] = [
  { path: "build", directory: true },
  { path: "build/entitlements.plist", directory: false },
  { path: "build/icon.png", directory: false },
  { path: "electron", directory: true },
  { path: "electron/git", directory: true },
  { path: "electron/git/changes.ts", directory: false },
  { path: "electron/git/worktree.ts", directory: false },
  { path: "electron/ipc", directory: true },
  { path: "electron/ipc/channels.ts", directory: false },
  { path: "electron/ipc/register-explorer.ts", directory: false },
  { path: "scripts", directory: true },
  { path: "scripts/design-language.test.ts", directory: false },
  { path: "scripts/electron-ipc-contract.test.ts", directory: false },
  { path: "src", directory: true },
  { path: "src/files", directory: true },
  { path: "src/files/changes", directory: true },
  { path: "src/files/changes/changes-list.tsx", directory: false },
  { path: "src/files/legacy-status.ts", directory: false },
  { path: "src/files/ui", directory: true },
  { path: "src/files/ui/explorer-tab.tsx", directory: false },
  { path: "src/files/ui/file-tree-view.tsx", directory: false },
  { path: "src/host", directory: true },
  { path: "src/host/git-changes-host.ts", directory: false },
  { path: "AGENTS.md", directory: false },
  { path: "package.json", directory: false },
];

/** Changed files and their ancestors only — what the filter leaves. */
export function prunedTree(): readonly TreeNode[] {
  const keep = new Set<string>();
  for (const entry of CHANGES) {
    const parts = entry.path.split("/");
    for (let end = 1; end <= parts.length; end += 1) {
      keep.add(parts.slice(0, end).join("/"));
    }
  }
  return TREE.filter((node) => keep.has(node.path));
}

/* ── the real tree, seeded ──────────────────────────────────────── */

/** Answers nothing: the specimen seeds the store directly, so no listing is
 * ever fetched and no write ever leaves the page. */
export const inertClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "gallery specimen" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 0, size: 0 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 0, size: 0 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  createEntry: async (_root, parent, name) => ({ path: `${parent}/${name}` }),
  listenFileChanged: async () => () => {},
};

const entry = (node: TreeNode): DirEntry => {
  const { name } = splitPath(node.path);
  return { name, path: `${ROOT}/${node.path}`, directory: node.directory, outOfRoot: false };
};

let seeded = false;

/** Seeds the store the real `ExplorerTab` reads, once: `toggleDirectory` flips,
 * so a second call after a section switch would close what the first opened. */
export function seedTree(): void {
  if (seeded) {
    return;
  }
  seeded = true;
  const children = (parent: string): readonly DirEntry[] =>
    TREE.filter((node) => {
      const { dir } = splitPath(node.path);
      return dir === parent;
    }).map(entry);
  const parents = new Set(TREE.filter((node) => node.directory).map((node) => node.path));
  setListing(ROOT, ROOT, children(""));
  for (const parent of parents) {
    setListing(ROOT, `${ROOT}/${parent}`, children(parent));
  }
  toggleDirectory(ROOT, `${ROOT}/src`);
  toggleDirectory(ROOT, `${ROOT}/src/files`);
}
