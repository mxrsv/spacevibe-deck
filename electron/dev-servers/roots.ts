/**
 * Workspace roots for dev-server attribution.
 *
 * A listener process is attributed by its working directory, which macOS reports as a
 * canonical kernel path (`/tmp` appears as `/private/tmp`, on-disk case). Roots arrive as
 * the strings a window spelled, so they are canonicalised with the ASYNC `realpath`
 * (`fs.promises.realpath` is native and also restores on-disk case on APFS; the callback
 * `fs.realpath` keeps the caller's case). Matching then compares whole path components and
 * prefers the deepest root, unlike the first-match `workspace-for-path.ts`, which answers
 * a different question (which of a window's tabs holds a file) and spells the root the
 * caller's way.
 */
import fs from "node:fs";
import path from "node:path";

export const MAX_ROOTS = 64;
export const MAX_ROOT_LENGTH = 4096;
const MAX_REPORTED_ROOT_CHARS = 120;

export interface CanonicalRoot {
  /** The root as the caller spelled it; shown back to that caller. */
  readonly input: string;
  /** Realpath used for matching. */
  readonly canonical: string;
}

export type RootDiagnosticCode = "invalid" | "not-found" | "unreadable" | "over-limit";

export interface RootDiagnostic {
  readonly code: RootDiagnosticCode;
  /** Truncated spelling of the offending root, or an empty string when it was not text. */
  readonly root: string;
  readonly message: string;
}

export interface CanonicalizedRoots {
  readonly roots: readonly CanonicalRoot[];
  readonly diagnostics: readonly RootDiagnostic[];
}

export type RealpathFn = (target: string) => Promise<string>;

function diagnostic(code: RootDiagnosticCode, root: unknown, message: string): RootDiagnostic {
  const text = typeof root === "string" ? root.slice(0, MAX_REPORTED_ROOT_CHARS) : "";
  return { code, root: text, message };
}

function invalidReason(root: unknown): string | null {
  if (typeof root !== "string") {
    return "Root must be a string";
  }
  if (root.length === 0 || root.length > MAX_ROOT_LENGTH) {
    return "Root must be 1 to 4096 characters";
  }
  if (root.includes("\0")) {
    return "Root must not contain NUL";
  }
  return path.isAbsolute(root) ? null : "Root must be an absolute path";
}

async function canonicalizeOne(
  input: unknown,
  realpath: RealpathFn,
): Promise<CanonicalRoot | RootDiagnostic> {
  const reason = invalidReason(input);
  if (reason !== null || typeof input !== "string") {
    return diagnostic("invalid", input, reason ?? "Root must be a string");
  }
  try {
    return { input, canonical: await realpath(input) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR"
      ? diagnostic("not-found", input, "Directory does not exist")
      : diagnostic("unreadable", input, "Directory could not be resolved");
  }
}

function isRoot(result: CanonicalRoot | RootDiagnostic): result is CanonicalRoot {
  return "canonical" in result;
}

/**
 * Validate and canonicalise a caller's root list. Never throws: every rejected root is a
 * diagnostic, so a bad entry cannot silently turn into an empty success. Two spellings of
 * one directory collapse to the first.
 */
export async function canonicalizeRoots(
  inputs: unknown,
  realpath: RealpathFn = fs.promises.realpath,
): Promise<CanonicalizedRoots> {
  if (!Array.isArray(inputs)) {
    return { roots: [], diagnostics: [diagnostic("invalid", null, "Roots must be an array")] };
  }
  const diagnostics: RootDiagnostic[] = [];
  if (inputs.length > MAX_ROOTS) {
    diagnostics.push(diagnostic("over-limit", null, `Only the first ${MAX_ROOTS} roots are used`));
  }
  const results = await Promise.all(
    inputs.slice(0, MAX_ROOTS).map((input) => canonicalizeOne(input, realpath)),
  );
  const seen = new Set<string>();
  const roots: CanonicalRoot[] = [];
  for (const result of results) {
    if (!isRoot(result)) {
      diagnostics.push(result);
    } else if (!seen.has(result.canonical)) {
      seen.add(result.canonical);
      roots.push(result);
    }
  }
  return { roots, diagnostics };
}

/** Path-segment containment: `/p` holds `/p` and `/p/a`, never `/p-other`. */
export function isWithinRoot(root: string, target: string): boolean {
  if (target === root) {
    return true;
  }
  return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** The most specific root holding `target`, or null. Ties cannot occur: roots are unique. */
export function deepestRoot(roots: readonly CanonicalRoot[], target: string): CanonicalRoot | null {
  let best: CanonicalRoot | null = null;
  for (const root of roots) {
    if (
      isWithinRoot(root.canonical, target) &&
      (best === null || root.canonical.length > best.canonical.length)
    ) {
      best = root;
    }
  }
  return best;
}
