/**
 * What main will accept as a dev server root list. `electron/ipc/register-dev-servers.ts`
 * rejects the WHOLE call for one relative, NUL-bearing or over-long root, or for more than
 * `MAX_ROOTS`, and leaves the previous roots in place. That strictness is a security
 * boundary and stays; the renderer therefore sends only roots that pass it, so one odd
 * recent path cannot blind the whole window.
 *
 * The limits mirror `electron/dev-servers/roots.ts`; a test keeps them equal.
 */

export const MAX_SENDABLE_ROOTS = 64;
export const MAX_SENDABLE_ROOT_LENGTH = 4096;

// POSIX absolute, a Windows drive (`C:\`, `C:/`), or a UNC prefix.
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

export function isSendableRoot(root: string): boolean {
  return (
    root.length > 0 &&
    root.length <= MAX_SENDABLE_ROOT_LENGTH &&
    !root.includes("\0") &&
    ABSOLUTE_PATH.test(root)
  );
}

/** The first `MAX_SENDABLE_ROOTS` distinct valid roots, in the order given. */
export function sendableRoots(roots: Iterable<string>): string[] {
  const kept = new Set<string>();
  for (const root of roots) {
    if (kept.size >= MAX_SENDABLE_ROOTS) {
      break;
    }
    if (isSendableRoot(root)) {
      kept.add(root);
    }
  }
  return [...kept];
}
