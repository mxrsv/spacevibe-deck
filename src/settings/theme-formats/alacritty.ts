/**
 * Alacritty colour schemes (`.toml`).
 *
 * Only the `[colors.*]` tables are read, and only their string values — which
 * is why this file carries a hand-written scanner instead of pulling in a TOML
 * parser. A general parser would add a runtime dependency (an `AGENTS.md` fork)
 * to read a grammar this narrow: five known table headers, `key = "value"`
 * lines, and nothing else. Anything richer in the file is skipped, never fatal.
 *
 * Alacritty's older YAML schemes are deliberately NOT supported. They are a
 * different grammar with the same colour names, and guessing between them from
 * an unquoted value is how a half-parsed theme reaches the gallery looking
 * complete.
 */
import { normalizeHex } from "./normalize-hex";
import { emptyDraft, type ThemeDraft } from "./theme-draft";

const TABLE = /^\s*\[([^\]]+)\]\s*$/;
const PAIR = /^\s*([A-Za-z_][\w-]*)\s*=\s*(.+?)\s*$/;

/**
 * `<table>.<key>` → `ITheme` key.
 *
 * Flattened into one table rather than nested lookups because the mapping is
 * not uniform: `colors.selection.background` and `colors.primary.background`
 * are the same key name in different tables meaning different slots, and a
 * per-table branch would have to re-state that anyway.
 */
const SLOT_MAP: Readonly<Record<string, string>> = {
  "colors.primary.background": "background",
  "colors.primary.foreground": "foreground",
  "colors.cursor.cursor": "cursor",
  "colors.selection.background": "selectionBackground",
  "colors.normal.black": "black",
  "colors.normal.red": "red",
  "colors.normal.green": "green",
  "colors.normal.yellow": "yellow",
  "colors.normal.blue": "blue",
  "colors.normal.magenta": "magenta",
  "colors.normal.cyan": "cyan",
  "colors.normal.white": "white",
  "colors.bright.black": "brightBlack",
  "colors.bright.red": "brightRed",
  "colors.bright.green": "brightGreen",
  "colors.bright.yellow": "brightYellow",
  "colors.bright.blue": "brightBlue",
  "colors.bright.magenta": "brightMagenta",
  "colors.bright.cyan": "brightCyan",
  "colors.bright.white": "brightWhite",
};

export function looksLikeAlacritty(source: string): boolean {
  return /^\s*\[colors(\.[\w.]+)?\]\s*$/m.test(source);
}

export function parseAlacritty(source: string): ThemeDraft | null {
  if (!looksLikeAlacritty(source)) {
    return null;
  }
  const draft = emptyDraft();
  let table = "";
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const header = TABLE.exec(line);
    if (header !== null) {
      table = header[1].trim();
      continue;
    }
    const pair = PAIR.exec(stripComment(line));
    if (pair === null || !table.startsWith("colors")) {
      continue;
    }
    const slot = SLOT_MAP[`${table}.${pair[1]}`];
    if (slot === undefined) {
      continue;
    }
    const hex = normalizeHex(unquote(pair[2]));
    if (hex !== null) {
      Object.assign(draft.colors, { [slot]: hex });
    }
  }
  return draft;
}

/**
 * Drop a trailing `# comment`.
 *
 * Only outside quotes: every colour this parser wants is a quoted string
 * starting with `#`, so cutting at the first hash would erase the value on
 * every line that matters.
 */
function stripComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      quoted = !quoted;
    } else if (character === "#" && !quoted) {
      return line.slice(0, index);
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
