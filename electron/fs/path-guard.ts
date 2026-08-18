/**
 * The workspace-root bound every filesystem channel shares (plan T5).
 *
 * One rule, stated once: a path is legal only if, after `realpath`, it is
 * inside the workspace root — itself realpath'd. Everything the explorer reads
 * or writes goes through here, because the renderer supplies the path and the
 * renderer is not the trust boundary. A symlinked directory pointing out of the
 * root is the case that motivates resolving BOTH sides: comparing a resolved
 * candidate against an unresolved root fails the moment the root is itself a
 * symlink (`/tmp` is one on macOS), which would reject every path in a
 * workspace opened through it.
 *
 * Same instinct as `hasRejectedRoot` in `links.ts`: refuse before touching the
 * filesystem where possible, and refuse loudly rather than degrade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hasRejectedRoot } from '../shell-integration';

/** Upper bound on one path, mirroring `links.ts`'s own cap. */
const MAX_PATH_BYTES = 32_768;

export class PathOutsideWorkspaceError extends Error {
  constructor(target: string) {
    super(`Path is outside the workspace: ${target}`);
    this.name = 'PathOutsideWorkspaceError';
  }
}

/** Seam so the tests can drive the guard over a fake filesystem. */
export interface PathGuardFs {
  realpathSync(target: string): string;
  /**
   * Whether the path exists as an entry of its parent directory, WITHOUT
   * following it. `lstat`, not `stat`: the entry that matters here is the
   * symlink itself, not what it points at.
   */
  entryExists(target: string): boolean;
}

const nodeFs: PathGuardFs = {
  realpathSync: (target) => fs.realpathSync(target),
  entryExists: (target) => {
    try {
      fs.lstatSync(target);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * True when `child` is `parent` itself or lives under it.
 *
 * Compared segment-wise rather than with `startsWith`, which would accept
 * `/repo-backup` for a root of `/repo`.
 */
export function isInside(parent: string, child: string): boolean {
  if (child === parent) {
    return true;
  }
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The canonical form of `root`, or null when it cannot be read.
 *
 * Resolved once per call rather than cached: a workspace can be moved or
 * replaced while Deck is running, and a cached root would keep authorizing
 * writes into a directory the user no longer has open.
 */
export function resolveRoot(root: string, io: PathGuardFs = nodeFs): string | null {
  if (typeof root !== 'string' || root.length === 0 || root.length > MAX_PATH_BYTES) {
    return null;
  }
  if (!path.isAbsolute(root) || hasRejectedRoot(root)) {
    return null;
  }
  try {
    return io.realpathSync(root);
  } catch {
    return null;
  }
}

/**
 * The canonical absolute path of `target` when it is inside `root`, else null.
 *
 * Null covers three different situations on purpose — outside the root, an
 * unreadable root, and a path that does not exist — because the caller's answer
 * is the same for all three: refuse. A caller that needs to distinguish "does
 * not exist" asks the filesystem itself afterwards.
 */
export function resolveInsideRoot(
  root: string,
  target: string,
  io: PathGuardFs = nodeFs,
): string | null {
  const canonicalRoot = resolveRoot(root, io);
  if (canonicalRoot === null) {
    return null;
  }
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    target.length > MAX_PATH_BYTES ||
    target.includes('\0')
  ) {
    return null;
  }
  const absolute = path.isAbsolute(target) ? target : path.join(canonicalRoot, target);
  if (hasRejectedRoot(absolute)) {
    return null;
  }
  let canonical: string;
  try {
    canonical = io.realpathSync(absolute);
  } catch {
    return null;
  }
  return isInside(canonicalRoot, canonical) ? canonical : null;
}

/** `resolveInsideRoot` that throws instead of returning null — for IPC handlers,
 * where a rejected path must surface as an error the renderer can report rather
 * than as a silently empty result. */
export function assertInsideRoot(root: string, target: string, io: PathGuardFs = nodeFs): string {
  const resolved = resolveInsideRoot(root, target, io);
  if (resolved === null) {
    throw new PathOutsideWorkspaceError(String(target));
  }
  return resolved;
}

/**
 * The canonical path a NEW file would occupy: the parent must exist inside the
 * root, the leaf need not.
 *
 * Writing goes through this rather than `assertInsideRoot` because a save to a
 * path the agent has just deleted must still work — the spec's dirty+deleted
 * row offers "Save again", and that file does not exist at the moment the user
 * clicks it.
 */
export function assertWritableInsideRoot(
  root: string,
  target: string,
  io: PathGuardFs = nodeFs,
): string {
  const existing = resolveInsideRoot(root, target, io);
  if (existing !== null) {
    return existing;
  }
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    throw new PathOutsideWorkspaceError(String(target));
  }
  // The path EXISTS and still did not resolve inside the root — a symlink
  // pointing out, most sharply. Falling through to the parent check here was a
  // real escape: the parent is inside the root, so the write was allowed, and
  // `fs.writeFile` then followed the link straight out of the workspace.
  // Caught by `write.test.ts`'s "through a link or otherwise" case.
  if (io.entryExists(target)) {
    throw new PathOutsideWorkspaceError(target);
  }
  // A path that does not exist: only its PARENT has to be inside the root, and
  // the parent is canonicalized before the leaf is joined onto it.
  const parent = resolveInsideRoot(root, path.dirname(target), io);
  if (parent === null) {
    throw new PathOutsideWorkspaceError(target);
  }
  return path.join(parent, path.basename(target));
}
