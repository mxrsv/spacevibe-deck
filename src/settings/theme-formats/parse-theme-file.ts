/**
 * One file on disk → one theme the gallery can show.
 *
 * The extension picks the first parser to try; every parser is then tried in
 * turn, because the two formats with no extension of their own (Ghostty ships
 * extensionless files, and half the Windows Terminal schemes in circulation are
 * saved as `.txt`) would otherwise be unreachable. Each parser answers "not
 * mine" with null, so ordering is an optimisation, not a correctness rule.
 *
 * The result is deliberately a value, not an exception: an import that fails
 * has to be able to say WHY on the surface the user is looking at, and a folder
 * scan that threw on one bad file would lose every good one after it.
 */
import { parseAlacritty } from "./alacritty";
import { parseGhostty } from "./ghostty";
import { parseItermColors } from "./itermcolors";
import { finishDraft, type ThemeDraft, type ThemeParseResult } from "./theme-draft";
import { parseWindowsTerminal } from "./windows-terminal";

/** File extensions the import dialog and the folder scan accept. */
export const THEME_FILE_EXTENSIONS = [
  "json",
  "itermcolors",
  "toml",
  "conf",
  "theme",
  "txt",
] as const;

type Parser = (source: string) => ThemeDraft | null;

const BY_EXTENSION: Readonly<Record<string, Parser>> = {
  json: parseWindowsTerminal,
  itermcolors: parseItermColors,
  toml: parseAlacritty,
};

const ALL_PARSERS: readonly Parser[] = [
  parseWindowsTerminal,
  parseItermColors,
  parseAlacritty,
  parseGhostty,
];

export interface ThemeFileParse {
  /** Stable across rescans: the file IS the identity of a custom theme. */
  readonly id: string;
  readonly result: ThemeParseResult;
}

export function parseThemeFile(fileName: string, source: string): ThemeFileParse {
  return { id: themeIdForFile(fileName), result: run(fileName, source) };
}

/** `file:` namespaced so a custom theme can never collide with a built-in id. */
export function themeIdForFile(fileName: string): string {
  return `file:${fileName}`;
}

function run(fileName: string, source: string): ThemeParseResult {
  if (source.trim().length === 0) {
    return { ok: false, reason: "the file is empty" };
  }
  const hinted = BY_EXTENSION[extensionOf(fileName)];
  const ordered =
    hinted === undefined
      ? ALL_PARSERS
      : [hinted, ...ALL_PARSERS.filter((parser) => parser !== hinted)];
  for (const parser of ordered) {
    const draft = parser(source);
    if (draft !== null) {
      return finishDraft(draft, labelFromFileName(fileName));
    }
  }
  return {
    ok: false,
    reason: "not a Windows Terminal, iTerm2, Alacritty or Ghostty theme",
  };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/**
 * `tokyo-night_storm.itermcolors` → `Tokyo Night Storm`.
 *
 * Only used when the format carries no name of its own, which is every iTerm2
 * preset and most Ghostty files. Title case rather than the lowercase the rest
 * of settings uses (DL-8): this is a proper name the user brought with them,
 * not a value the app chose.
 */
export function labelFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot <= 0 ? fileName : fileName.slice(0, dot);
  const words = stem
    .split(/[-_\s.]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : fileName;
}
