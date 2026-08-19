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
  /**
   * Exactly the text the user sees and clicks — including a `:line:col` or a
   * `(line,col)` suffix, excluding the quotes of a quoted path and Python's
   * trailing `, line N`, which are the printer's punctuation rather than the
   * thing being pointed at.
   */
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
const URL_RE =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;

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
// Two position grammars, one suffix. `tsc` writes `path(line,col)` where
// everything else writes `path:line:col`, and losing that position was the
// gap: the file linked, the line did not travel with it.
//
// The parenthesised form is tried FIRST because the colon form can match
// EMPTY — an alternation would settle on the empty branch and leave
// `(340,15)` outside the candidate, which is the bug rather than the fix.
// Both alternatives capture, so the group numbers below are 3/4 for the
// parenthesised pair and 5/6 for the colon pair; `matchPathPattern` reads
// whichever of the two answered. A single number in parentheses is NOT a
// position (`Read(src/foo.ts)` is a Claude Code tool line, and `foo.ts(3)`
// is prose), so the comma is required.
const PAREN_SUFFIX = String.raw`\((\d+),(\d+)\)`;
const COLON_SUFFIX = String.raw`(?::(\d+))?(?::(\d+))?`;
const SUFFIX = `(?:${PAREN_SUFFIX}|${COLON_SUFFIX})`;
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

/**
 * A path inside double quotes, with Python's `, line N` when it follows.
 *
 * This is the ONLY route to a path containing a space: an unquoted one is
 * ambiguous and stays unmatched by design (see `SEG_CHAR`), but a quote is a
 * boundary the printer chose, so the token is stated rather than guessed.
 * Python's traceback (`File "src/x.py", line 12`) is the sample §2.2 names,
 * and its line number is captured even though it sits outside the clickable
 * text — the text is the path, because that is the thing being pointed at.
 *
 * The tradeoff, accepted: a quoted PHRASE that happens to contain a path
 * (`"look at src/foo.ts"`) becomes one candidate covering the whole phrase
 * and suppresses the bare path inside it, so that line resolves to nothing
 * and links nothing. Tool and agent output quotes paths far more often than
 * it quotes prose about paths, and the alternative — emitting both and
 * letting them overlap — hands xterm two links over the same cells.
 * Single quotes are deliberately NOT matched: an apostrophe in ordinary
 * prose would pair with the next one and swallow every path between them.
 */
const QUOTED_MAX = 256;
const QUOTED_PATH_RE = new RegExp(
  `"([${SEG_CHAR} /\\\\]{1,${QUOTED_MAX}})"(?:,\\s*line\\s+(\\d+))?`,
  "gu",
);

/** A quoted token is only a candidate if it could be a path at all. */
function looksLikePath(body: string): boolean {
  return (
    body.includes("/") ||
    body.includes("\\") ||
    /\.[A-Za-z][A-Za-z0-9]{0,9}$/u.test(body)
  );
}

/**
 * The same path without git's `a/` or `b/` diff prefix, or null when it
 * carries neither.
 *
 * Stripping happens in the RENDERER, not in `resolveOne` (§2.2): the resolver
 * has a Rust twin (`src-tauri/src/links.rs`), so a fix there would either be
 * written twice or become a host parity gap, and it would reshape a payload R6
 * freezes. The caller emits both spellings into the same resolve batch and
 * prefers the verbatim hit, so `resolve_paths` never learns what a diff is.
 */
export function stripDiffPrefix(target: string): string | null {
  return /^[ab]\//u.test(target) ? target.slice(2) : null;
}

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

function followsSpacedAbsoluteWindowsPath(
  source: string,
  start: number,
): boolean {
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

function startsSpacedAbsoluteWindowsPath(
  source: string,
  start: number,
  end: number,
): boolean {
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
    // 3/4 is `(line,col)`, 5/6 is `:line:col` — see `SUFFIX`. Exactly one of
    // the two pairs can have answered, so the coalesce is not a preference.
    const line = toInt(m[3] ?? m[5]);
    const col = toInt(m[4] ?? m[6]);
    // Only trim when nothing follows the path — `foo.:12` cannot occur, so a
    // trailing dot here is always sentence punctuation.
    const path = line === null ? trimTrailingDots(rawPath) : rawPath;
    if (path === "") {
      continue;
    }
    const matched = m[0].slice(boundary.length);
    const text = matched.slice(
      0,
      matched.length - (rawPath.length - path.length),
    );
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

function matchQuotedPaths(source: string): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  QUOTED_PATH_RE.lastIndex = 0;
  for (
    let m = QUOTED_PATH_RE.exec(source);
    m !== null;
    m = QUOTED_PATH_RE.exec(source)
  ) {
    const body = m[1] ?? "";
    // A body padded with spaces is a phrase that ended in one, never a path
    // anybody typed — and trimming it would leave the range lying about which
    // cells the link covers.
    if (body !== body.trim() || !looksLikePath(body)) {
      continue;
    }
    // `+ 1` steps past the opening quote: the quotes bound the token, they are
    // not part of it, so the underline stops at the path.
    const start = m.index + 1;
    out.push({
      kind: "path",
      text: body,
      target: body,
      line: toInt(m[2]),
      col: null,
      start,
      end: start + body.length,
    });
  }
  return out;
}

function matchPaths(source: string): LinkCandidate[] {
  // Quoted wins outright: it is the only form that can carry a space, and on
  // Python's line it is the only one that carries the position.
  const quoted = matchQuotedPaths(source);
  const windows = matchPathPattern(source, WINDOWS_PATH_RE).filter(
    (candidate) => !quoted.some((quote) => overlaps(candidate, quote)),
  );
  const portable = matchPathPattern(source, PATH_RE).filter(
    (candidate) =>
      !windows.some((windowsPath) => overlaps(candidate, windowsPath)) &&
      !quoted.some((quote) => overlaps(candidate, quote)),
  );
  return [...quoted, ...windows, ...portable].sort((a, b) => a.start - b.start);
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
  const paths = matchPaths(source).filter(
    (path) => !urls.some((url) => overlaps(path, url)),
  );
  return [...urls, ...paths].sort((a, b) => a.start - b.start).slice(0, max);
}
