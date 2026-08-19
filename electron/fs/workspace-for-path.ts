/**
 * Which open workspace root holds a path (design §3.1).
 *
 * This is decided HERE, not by prefix-matching in the renderer, for the reason
 * `path-guard.ts` already documents: `resolve_paths` answers canonical
 * (realpath'd) absolutes, the renderer holds roots as the raw strings the user
 * opened, and comparing the two fails the moment a root is itself a symlink —
 * `/tmp` on macOS is one. Reusing `resolveInsideRoot` means a ⌘+click passes
 * exactly the guard the explorer's own reads and writes pass.
 *
 * The answer is the root **as the renderer spelled it**, never its canonical
 * form: every file-surface lookup is keyed by that string, so handing back a
 * realpath would open a tab in a workspace the store has never heard of.
 */
import { resolveInsideRoot } from "./path-guard";

/** Upper bound on one request's root list — a window has a handful of tabs. */
const MAX_ROOTS = 64;

export interface WorkspaceForPathRequest {
  readonly path: string;
  /** Open workspace roots, most relevant first: the clicked pane's own tab,
   * then the window's others. First match wins, so order is the preference. */
  readonly roots: readonly string[];
}

export function workspaceForPath(
  request: WorkspaceForPathRequest,
): string | null {
  const { path: target, roots } = request;
  if (typeof target !== "string" || target.length === 0) {
    return null;
  }
  if (!Array.isArray(roots)) {
    return null;
  }
  for (const root of roots.slice(0, MAX_ROOTS)) {
    if (typeof root !== "string" || root.length === 0) {
      continue;
    }
    if (resolveInsideRoot(root, target) !== null) {
      return root;
    }
  }
  return null;
}
