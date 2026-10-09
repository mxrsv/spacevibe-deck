/**
 * What the explorer has to do next to show one document's row.
 *
 * Revealing is a loop, not a call: a collapsed folder has to be opened, its
 * listing has to arrive, and only then is the next folder down known. This
 * module answers the single next move from the state the store already holds;
 * `FileTreeView` performs it through the controller and asks again when the
 * store changes. Pure — no host, no DOM, no store — so each case is a plain
 * argument list.
 *
 * Paths are matched against the LISTED entries and never against the
 * workspace path. `list_dir` joins names onto the realpath'd directory, and a
 * ⌘+click path is realpath'd too, while the root key keeps the renderer's
 * spelling: under a symlinked root (macOS `/tmp`) no row path starts with the
 * root's own string, so a prefix test against it would match nothing.
 *
 * A cached listing of a closed folder is trusted as it is: expanding that
 * folder by hand shows the same list.
 */
import { canExpand, isVisible, type Listings } from "./file-tree";

export type RevealStep =
  /** Every ancestor is open; the row is in the model. */
  | { readonly kind: "done" }
  /** The root row is shut. */
  | { readonly kind: "open-root" }
  /** The outermost closed ancestor. Never one already in `expanded`, which
   * `toggleDirectory` would collapse. */
  | { readonly kind: "expand"; readonly directory: string }
  /** A listing the walk needs is on its way; ask again when it lands. */
  | { readonly kind: "wait" }
  /** The tree cannot show this document, and nothing should change. */
  | { readonly kind: "none" };

export interface RevealState {
  /** The document's absolute path. */
  readonly target: string;
  /** The tree's root key. Only its listing is read, never its spelling. */
  readonly root: string;
  readonly listings: Listings;
  readonly expanded: ReadonlySet<string>;
  readonly rootExpanded: boolean;
  readonly showHidden: boolean;
  /** Directories whose last read failed, keyed by path. */
  readonly listingErrors: ReadonlyMap<string, unknown>;
}

/** `entry` is the target or a folder above it, by whole path segments. */
function onPath(entryPath: string, target: string): boolean {
  return (
    target === entryPath ||
    target.startsWith(`${entryPath}/`) ||
    target.startsWith(`${entryPath}\\`)
  );
}

export function nextRevealStep(state: RevealState): RevealStep {
  const { target, root, listings, expanded, showHidden, listingErrors } = state;
  // The first closed ancestor, top-down. Remembered rather than returned at
  // once so a document the tree cannot show answers `none` before anything
  // has been opened for it.
  let closed: RevealStep | null = state.rootExpanded ? null : { kind: "open-root" };
  let directory = root;
  // Entry paths only ever lengthen, so a well-formed listing ends the walk;
  // a listing that names a folder inside itself must not loop it.
  const walked = new Set<string>();
  for (;;) {
    const listing = listings.get(directory);
    if (listing === undefined) {
      if (listingErrors.has(directory)) {
        return { kind: "none" };
      }
      // Nothing is known below an unlisted ROOT, so nothing is opened for it
      // yet. Deeper down the path to `directory` is already verified, and
      // opening its closed ancestor is what loads the listing.
      return directory === root ? { kind: "wait" } : (closed ?? { kind: "wait" });
    }
    const entry = listing.find(
      (candidate) => isVisible(candidate, showHidden) && onPath(candidate.path, target),
    );
    if (entry === undefined) {
      return { kind: "none" };
    }
    if (entry.path === target) {
      return closed ?? { kind: "done" };
    }
    // An ancestor that cannot be opened: a file, or a symlink out of the root.
    if (!canExpand(entry)) {
      return { kind: "none" };
    }
    if (walked.has(entry.path)) {
      return { kind: "none" };
    }
    walked.add(entry.path);
    if (closed === null && !expanded.has(entry.path)) {
      closed = { kind: "expand", directory: entry.path };
    }
    directory = entry.path;
  }
}
