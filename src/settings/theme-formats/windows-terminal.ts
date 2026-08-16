/**
 * Windows Terminal colour schemes (`.json`).
 *
 * The de facto interchange format: windowsterminalthemes.dev, the Windows
 * Terminal fragment format and most "here is my palette" gists all emit this
 * one object, and its keys map onto xterm's `ITheme` almost one for one. The
 * only rename is `purple` → `magenta`, which is Microsoft's naming of ANSI 5.
 *
 * Three container shapes are accepted because all three are what people
 * actually have on disk: a bare scheme, an array of schemes exported in bulk,
 * and a whole `settings.json` with a `schemes` array inside it. The first
 * scheme wins — a file holding several is a collection, and picking one is the
 * import dialog's job on a later pass, not a reason to reject the file now.
 */
import { normalizeHex } from "./normalize-hex";
import { emptyDraft, type ThemeDraft } from "./theme-draft";

/** Scheme key → `ITheme` key. Keys absent here are ignored, never fatal. */
const KEY_MAP: Readonly<Record<string, string>> = {
  background: "background",
  foreground: "foreground",
  cursorColor: "cursor",
  selectionBackground: "selectionBackground",
  black: "black",
  red: "red",
  green: "green",
  yellow: "yellow",
  blue: "blue",
  purple: "magenta",
  cyan: "cyan",
  white: "white",
  brightBlack: "brightBlack",
  brightRed: "brightRed",
  brightGreen: "brightGreen",
  brightYellow: "brightYellow",
  brightBlue: "brightBlue",
  brightPurple: "brightMagenta",
  brightCyan: "brightCyan",
  brightWhite: "brightWhite",
};

export function parseWindowsTerminal(source: string): ThemeDraft | null {
  const scheme = firstScheme(source);
  if (scheme === null) {
    return null;
  }
  const draft = emptyDraft();
  const name = scheme.name;
  if (typeof name === "string" && name.trim().length > 0) {
    draft.label = name.trim();
  }
  for (const [schemeKey, themeKey] of Object.entries(KEY_MAP)) {
    const raw = scheme[schemeKey];
    if (typeof raw !== "string") {
      continue;
    }
    const hex = normalizeHex(raw);
    if (hex !== null) {
      Object.assign(draft.colors, { [themeKey]: hex });
    }
  }
  return draft;
}

type Scheme = Record<string, unknown>;

/**
 * Unwrap the three container shapes to the one scheme this import uses.
 *
 * A parse failure is null rather than an exception: the dispatcher tries
 * parsers in turn, so "this is not my format" has to be a value it can act on.
 */
function firstScheme(source: string): Scheme | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  const candidates = unwrap(parsed);
  return candidates.find(isScheme) ?? null;
}

function unwrap(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const nested = (parsed as { schemes?: unknown }).schemes;
  return Array.isArray(nested) ? nested : [parsed];
}

/**
 * A scheme is an object carrying at least one recognised colour key.
 *
 * Deliberately NOT "carries background AND foreground": a scheme missing one of
 * them has to reach `finishDraft`, which is the one place that knows those two
 * are required and can name them. Rejecting here would report an incomplete
 * palette as "not a theme format at all", sending the user after a converter
 * when the file needs one line added.
 *
 * Testing colour keys rather than `name` is what lets an unnamed gist import,
 * and what keeps a VS Code theme out — its top level is `name`, `type`,
 * `colors`, `tokenColors`, so it matches nothing here and gets the honest
 * "unsupported format" answer instead of a half-read palette.
 */
function isScheme(value: unknown): value is Scheme {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Scheme;
  return Object.keys(KEY_MAP).some((key) => typeof record[key] === "string");
}
