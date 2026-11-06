/**
 * Text the peer controls and the UI shows: titles, names, last lines, notification copy. Control
 * characters (C0, DEL, C1) and the characters that reorder or hide text (bidi overrides, zero-width
 * joiners, line separators) are removed so a hostile or confused peer cannot repaint the screen
 * or disguise a label. Tabs and newlines become a space so words do not fuse. Terminal `data` is
 * the one exemption and never goes through here.
 */

/** A `\uXXXX` escape for the regex source, built so no control character sits in this file. */
function escape(codeUnit: number): string {
  return String.fromCharCode(0x5c) + "u" + codeUnit.toString(16).padStart(4, "0");
}

function characterClass(ranges: readonly (readonly [number, number])[]): RegExp {
  return new RegExp(
    "[" + ranges.map(([from, to]) => escape(from) + "-" + escape(to)).join("") + "]",
    "g",
  );
}

// Tab, newline, carriage return, line and paragraph separators: replaced by a space.
const SPACING = characterClass([
  [0x09, 0x0a],
  [0x0d, 0x0d],
  [0x2028, 0x2029],
]);
// C0 and C1 controls, DEL, zero-width and directional marks, bidi embeddings and isolates, BOM.
const STRIPPED = characterClass([
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
]);

/** Sanitised and cut to at most `max` code points (a surrogate pair is never split). */
export function displayText(text: string, max: number): string {
  const clean = text.replace(SPACING, " ").replace(STRIPPED, "").trim();
  const points = Array.from(clean);
  return points.length <= max ? clean : points.slice(0, max).join("").trimEnd();
}
