/**
 * Ghostty themes (extensionless config files).
 *
 * The simplest of the four: flat `key = value` lines, with the ANSI palette
 * written as sixteen `palette = N=#rrggbb` entries. Ghostty ships its whole
 * theme collection in this form, one file per theme, which is exactly the shape
 * the themes folder wants.
 *
 * Values are unquoted and the hash is optional (`background = 1d1f21` and
 * `background = #1d1f21` are both valid), so a `#` cannot be treated as a
 * comment marker wherever it appears — only a line that STARTS with one is a
 * comment. Getting that backwards silently drops every colour in the file.
 */
import { normalizeHex } from "./normalize-hex";
import { ANSI_SLOTS, emptyDraft, type ThemeDraft } from "./theme-draft";

const KEY_MAP: Readonly<Record<string, string>> = {
  background: "background",
  foreground: "foreground",
  "cursor-color": "cursor",
  "selection-background": "selectionBackground",
};

const PALETTE_ENTRY = /^(\d{1,2})\s*=\s*(.+)$/;

/**
 * Ghostty and Alacritty both write `background = …`, so the `[` table header
 * Alacritty cannot do without is what separates them. Requiring a recognised
 * key as well keeps an arbitrary INI-shaped file out.
 */
export function looksLikeGhostty(source: string): boolean {
  if (/^\s*\[/m.test(source)) {
    return false;
  }
  return /^\s*(palette|background|foreground|cursor-color|selection-background)\s*=/m.test(source);
}

export function parseGhostty(source: string): ThemeDraft | null {
  if (!looksLikeGhostty(source)) {
    return null;
  }
  const draft = emptyDraft();
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "palette") {
      applyPaletteEntry(draft, value);
      continue;
    }
    const slot = KEY_MAP[key];
    if (slot === undefined) {
      continue;
    }
    const hex = normalizeHex(value);
    if (hex !== null) {
      Object.assign(draft.colors, { [slot]: hex });
    }
  }
  return draft;
}

/** `4=#7aa2f7` → the `blue` slot. Out-of-range indices are ignored. */
function applyPaletteEntry(draft: ThemeDraft, value: string): void {
  const match = PALETTE_ENTRY.exec(value);
  if (match === null) {
    return;
  }
  const slot = ANSI_SLOTS[Number(match[1])];
  const hex = normalizeHex(match[2]);
  if (slot === undefined || hex === null) {
    return;
  }
  Object.assign(draft.colors, { [slot]: hex });
}
