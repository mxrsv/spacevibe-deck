/**
 * The tree model (plan T4): what a directory listing looks like once sorted,
 * filtered and flattened for a virtualized list.
 *
 * Pure — no host, no DOM, no Monaco. Nothing here knows what renders it, which
 * is what lets Phase 1 survive an editor-engine change (plan §0.3).
 */

export interface DirEntry {
  /**
   * Leaf name as the filesystem reports it. Real casing, never lowercased:
   * DL-4.1's lowercase rule governs chrome labels the app authors, and a file
   * name is data the app reports.
   */
  readonly name: string;
  /** Absolute path, already canonicalized by the host's path guard. */
  readonly path: string;
  readonly directory: boolean;
  /**
   * A symlink whose target resolves outside the workspace root. It renders as
   * a leaf and does not open (spec §3.1) — the host answers this, because only
   * the host can `realpath`.
   */
  readonly outOfRoot: boolean;
}

/**
 * Directories hidden by default, from ONE named constant (plan T4).
 *
 * Deliberately a fixed list and not `.gitignore`: parsing that properly needs a
 * matcher dependency, which is a fork, and parsing it badly is worse than this
 * list (spec §3.1). Named as a known gap in the plan's §4, not an oversight.
 */
export const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
]);

/** Dot-entries, revealed by the "show hidden" toggle and nothing else. */
export function isHidden(name: string): boolean {
  return name.startsWith(".");
}

/**
 * Whether an entry survives the default filter.
 *
 * `EXCLUDED_NAMES` wins over `showHidden`: revealing dot-entries is about
 * `.env` and `.github`, never about walking into `.git`, which is both huge and
 * meaningless to read in an editor.
 */
export function isVisible(entry: DirEntry, showHidden: boolean): boolean {
  if (EXCLUDED_NAMES.has(entry.name)) {
    return false;
  }
  return showHidden || !isHidden(entry.name);
}

/**
 * Directories first, then files, each alphabetical case-insensitive.
 *
 * `localeCompare` with `sensitivity: "base"` puts `README` next to `readme`
 * instead of in a separate ASCII block, which is what "case-insensitive"
 * actually means to someone scanning the column.
 *
 * The tie-break is a plain code-unit compare, NOT a second `localeCompare`:
 * which case ICU ranks first varies by ICU version, so a locale-aware
 * tie-break would make the row order depend on the Node build. Code units are
 * arbitrary but identical everywhere, which is what a total, stable order
 * needs to be.
 */
export function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.directory !== b.directory) {
      return a.directory ? -1 : 1;
    }
    const insensitive = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
    });
    if (insensitive !== 0) {
      return insensitive;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/** Sorted, filtered listing of one directory. */
export function visibleEntries(
  entries: readonly DirEntry[],
  showHidden: boolean,
): DirEntry[] {
  return sortEntries(entries.filter((entry) => isVisible(entry, showHidden)));
}

/** A directory the user may walk into. A symlink out of the root is a leaf. */
export function canExpand(entry: DirEntry): boolean {
  return entry.directory && !entry.outOfRoot;
}

/** One rendered row. `depth` is the indent level, 0 for a root child. */
export interface TreeRow {
  readonly path: string;
  readonly name: string;
  readonly directory: boolean;
  readonly depth: number;
  readonly expanded: boolean;
  readonly outOfRoot: boolean;
}

/** Listings the panel has loaded, keyed by directory path. */
export type Listings = ReadonlyMap<string, readonly DirEntry[]>;

/**
 * The flat row list a virtual list renders: a depth-first walk that descends
 * only into expanded directories whose listing has already arrived.
 *
 * An expanded directory with no listing yet contributes its own row and no
 * children — loading is the caller's job, and a tree that reordered itself when
 * a listing landed would move rows under the pointer.
 */
export function flattenTree(
  root: string,
  listings: Listings,
  expanded: ReadonlySet<string>,
  showHidden: boolean,
): TreeRow[] {
  const rows: TreeRow[] = [];
  // A directory is walked at most once. A symlink cycle wholly inside the root
  // would otherwise loop forever, and the out-of-root guard cannot catch it:
  // both ends of that link are legal paths.
  const walked = new Set<string>();
  const walk = (directory: string, depth: number): void => {
    if (walked.has(directory)) {
      return;
    }
    walked.add(directory);
    for (const entry of visibleEntries(listings.get(directory) ?? [], showHidden)) {
      const open = canExpand(entry) && expanded.has(entry.path);
      rows.push({
        path: entry.path,
        name: entry.name,
        directory: entry.directory,
        depth,
        expanded: open,
        outOfRoot: entry.outOfRoot,
      });
      if (open) {
        walk(entry.path, depth + 1);
      }
    }
  };
  walk(root, 0);
  return rows;
}

/** Toggle one directory's expansion, returning a new set. */
export function toggleExpanded(
  expanded: ReadonlySet<string>,
  path: string,
): Set<string> {
  const next = new Set(expanded);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

/**
 * Directories whose contents are on screen: the root plus every expanded
 * directory that is itself reachable.
 *
 * This is exactly the watch scope (spec §5) and exactly the set of listings
 * worth loading — one answer, so the two can never disagree about which
 * directories matter.
 */
export function openDirectories(rows: readonly TreeRow[], root: string): string[] {
  return [root, ...rows.filter((row) => row.expanded).map((row) => row.path)];
}
