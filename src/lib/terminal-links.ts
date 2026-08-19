/**
 * Pure link detection over one logical terminal line.
 *
 * Two kinds are recognised:
 *  - `url`  — http/https, opened in the default browser
 *  - `path` — a file path, optionally suffixed `:line` or `:line:col`
 *
 * Path matching is deliberately loose (agents print bare relative paths like
 * `src/foo.ts:12`), so a candidate is only a *candidate*: the caller resolves
 * it against the pane's cwd and drops the ones that are not real files.
 */

export type LinkKind = "url" | "path";

export interface LinkCandidate {
  readonly kind: LinkKind;
  /** Exactly the text the user sees and clicks (includes any `:line:col`). */
  readonly text: string;
  /** The URL, or the path without its `:line:col` suffix. */
  readonly target: string;
  readonly line: number | null;
  readonly col: number | null;
  /** Index into the source string, inclusive. */
  readonly start: number;
  /** Index into the source string, exclusive. */
  readonly end: number;
}

/** Bounds the resolve batch a single hover can trigger. */
export const MAX_CANDIDATES_PER_LINE = 24;

// http/https up to the first whitespace or quote, minus trailing punctuation.
// Copied from @xterm/addon-web-links (strictUrlRegex) — battle-tested there.
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;

/**
 * Whether a URI may be handed to the default browser.
 *
 * Detected links already come from `URL_RE`, but an OSC 8 hyperlink carries a
 * URI the *output* chose — anything printed to the terminal (a downloaded log,
 * a curl response) can ask for `file:///…` or an app-registered scheme like
 * `vscode://`. Only http/https ever reach the opener.
 */
export function isBrowsableUrl(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false; // not a URI at all
  }
}

// Characters a path segment is made of. Spaces are not included: an unquoted
// path with a space is ambiguous in terminal output, so it is left alone
// (VS Code does the same).
// The `-` stays escaped: it is interpolated into character classes that append
// more characters after it, where a bare trailing `-` would become a range.
// Letters/marks/numbers come from Unicode properties, not `A-Za-z0-9`: a
// filename may hold any script (`docs/ghi-chú.md`, `docs/日本語.md`), and an
// ASCII-only class stops matching at the first such character, silently
// truncating the candidate into a path that can never resolve. `\p{M}` covers
// the combining marks a decomposed (NFD) filename is made of — macOS hands
// those out from the filesystem. Symbols stay OUT on purpose: the box-drawing
// and bullet characters an agent TUI paints (`│`, `⏺`, emoji) are `\p{S}`, and
// pulling them in would fuse the decoration into the path.
const SEG_CHAR = String.raw`\p{L}\p{M}\p{N}_.+@%~$\-`;
const SEG = `[${SEG_CHAR}]+`;
// Either a slashed path (`/a/b`, `~/a`, `./a`, `src/a`) or a bare filename
// with an extension (`pane.ts`). A bare word with no dot is never a candidate.
const SLASHED = String.raw`(?:${SEG})?(?:/${SEG})+/?`;
const BARE = String.raw`${SEG}\.[A-Za-z][A-Za-z0-9]{0,9}`;
const WINDOWS_SEPARATOR = String.raw`[\\/]`;
const WINDOWS_DRIVE = String.raw`[A-Za-z]:${WINDOWS_SEPARATOR}${SEG}(?:${WINDOWS_SEPARATOR}${SEG})*${WINDOWS_SEPARATOR}?`;
const WINDOWS_UNC = String.raw`\\\\${SEG}\\${SEG}(?:\\${SEG})*\\?`;
const WINDOWS_RELATIVE = String.raw`(?:\.{1,2}\\)?${SEG}(?:\\${SEG})+\\?`;
const SUFFIX = String.raw`(?::(\d+))?(?::(\d+))?`;
// A candidate may only start at a token boundary, so a match never begins in
// the middle of a longer token. This is a *consumed* group rather than a
// lookbehind: JavaScriptCore only learned lookbehind in Safari 16.4, and
// tauri.conf declares support down to macOS 10.15 — a lookbehind there throws
// SyntaxError while the module is being evaluated, which takes the whole app
// down, not just the links. Consuming the boundary is safe because a separator
// can never be part of a path (it is outside SEG by construction), so two
// adjacent candidates can never fight over the same character.
// It also keeps matching linear: on a run of SEG characters every start
// position past the first fails on the boundary immediately, instead of
// backtracking through the run.
const BOUNDARY = `(?:^|[^${SEG_CHAR}/\\\\:])`;
// The `u` flag is what gives `\p{…}` its meaning; without it the escapes are
// read as a literal `p` and the class silently matches the wrong thing.
// JavaScriptCore has understood Unicode property escapes since Safari 11.1,
// well below the macOS floor tauri.conf declares.
const PATH_RE = new RegExp(`(${BOUNDARY})(${SLASHED}|${BARE})${SUFFIX}`, "gu");
const WINDOWS_PATH_RE = new RegExp(
  `(${BOUNDARY})(${WINDOWS_DRIVE}|${WINDOWS_UNC}|${WINDOWS_RELATIVE})${SUFFIX}`,
  "gu",
);

/** A sentence-final dot is punctuation, never part of the path. */
function trimTrailingDots(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === ".") {
    end -= 1;
  }
  return path.slice(0, end);
}

function toInt(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function matchUrls(source: string): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(source); m !== null; m = URL_RE.exec(source)) {
    out.push({
      kind: "url",
      text: m[0],
      target: m[0],
      line: null,
      col: null,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function followsSpacedAbsoluteWindowsPath(source: string, start: number): boolean {
  if (start === 0 || !/\s/u.test(source[start - 1] ?? "")) {
    return false;
  }
  const prefix = source.slice(0, start).trimEnd();
  const previousToken = prefix.slice(
    Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\t")) + 1,
  );
  const isAbsoluteWindows = /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(previousToken);
  const looksComplete = /\.[\p{L}\p{N}]+(?::\d+){0,2}$/u.test(previousToken);
  return isAbsoluteWindows && !looksComplete;
}

function startsSpacedAbsoluteWindowsPath(source: string, start: number, end: number): boolean {
  const candidate = source.slice(start, end);
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/u.test(candidate)) {
    return false;
  }
  if (/\.[\p{L}\p{N}]+(?::\d+){0,2}$/u.test(candidate)) {
    return false;
  }
  const remainder = source.slice(end);
  const continuation = /^\s+([^\s]+)/u.exec(remainder)?.[1] ?? "";
  return continuation.includes("\\") || continuation.includes("/");
}

function matchPathPattern(source: string, pattern: RegExp): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  pattern.lastIndex = 0;
  for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) {
    // m[1] is the consumed boundary character — it belongs to neither the
    // candidate's text nor its range.
    const boundary = m[1] ?? "";
    const rawPath = m[2] ?? "";
    const line = toInt(m[3]);
    const col = toInt(m[4]);
    // Only trim when nothing follows the path — `foo.:12` cannot occur, so a
    // trailing dot here is always sentence punctuation.
    const path = line === null ? trimTrailingDots(rawPath) : rawPath;
    if (path === "") {
      continue;
    }
    const matched = m[0].slice(boundary.length);
    const text = matched.slice(0, matched.length - (rawPath.length - path.length));
    const start = m.index + boundary.length;
    const end = start + text.length;
    if (
      followsSpacedAbsoluteWindowsPath(source, start) ||
      startsSpacedAbsoluteWindowsPath(source, start, end)
    ) {
      continue;
    }
    out.push({
      kind: "path",
      text,
      target: path,
      line,
      col,
      start,
      end,
    });
  }
  return out;
}

function matchPaths(source: string): LinkCandidate[] {
  const windows = matchPathPattern(source, WINDOWS_PATH_RE);
  const portable = matchPathPattern(source, PATH_RE).filter(
    (candidate) => !windows.some((windowsPath) => overlaps(candidate, windowsPath)),
  );
  return [...windows, ...portable].sort((a, b) => a.start - b.start);
}

function overlaps(a: LinkCandidate, b: LinkCandidate): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * All link candidates on `source`, ordered by position and capped at `max`.
 * URLs win over paths wherever the two overlap.
 */
export function extractLinkCandidates(
  source: string,
  max: number = MAX_CANDIDATES_PER_LINE,
): LinkCandidate[] {
  const urls = matchUrls(source);
  const paths = matchPaths(source).filter((path) => !urls.some((url) => overlaps(path, url)));
  return [...urls, ...paths].sort((a, b) => a.start - b.start).slice(0, max);
}
