/**
 * The one hex reader every theme-file parser shares.
 *
 * Each supported format writes colours a different way — Windows Terminal
 * quotes `#rrggbb`, Ghostty accepts the same value with or without the hash,
 * Alacritty ships `0x1d1f21` from its older docs, and iTerm2 does not write hex
 * at all. Normalising here rather than in four parsers is what keeps "is this a
 * colour" one answer instead of four subtly different ones.
 *
 * Output is always lowercase `#rrggbb`: xterm's `ITheme` and the `--bg`/`--fg`
 * custom properties both take CSS colours, and an 8-digit value would put an
 * alpha channel behind the terminal that `deriveChromeColors` cannot reason
 * about (DL-2.2 — every chrome colour is derived from an opaque `--bg`).
 */

const SHORT = /^[0-9a-f]{3}$/;
const LONG = /^[0-9a-f]{6}$/;
/** `#rrggbbaa` — alpha is read and dropped, see the module note. */
const WITH_ALPHA = /^[0-9a-f]{8}$/;

/**
 * Returns `#rrggbb`, or null when the text is not a colour this app can use.
 *
 * Null is a real answer, not a failure to try: a theme file may hold keys the
 * app has no slot for, and a parser that threw on the first unusable value
 * would reject whole themes over a decoration.
 */
export function normalizeHex(raw: string): string | null {
  let body = raw.trim().toLowerCase();
  if (body.startsWith("#")) {
    body = body.slice(1);
  } else if (body.startsWith("0x")) {
    body = body.slice(2);
  }
  if (SHORT.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  if (LONG.test(body)) {
    return `#${body}`;
  }
  if (WITH_ALPHA.test(body)) {
    return `#${body.slice(0, 6)}`;
  }
  return null;
}

/**
 * Build `#rrggbb` from three 0–1 channel floats — iTerm2's storage form.
 *
 * Rounds rather than truncates, and clamps: a plist written by a colour picker
 * can carry values a hair outside the range, and `Math.round(1.0000001 * 255)`
 * is 255 while an unclamped 1.004 is 256, which formats as `100` and produces a
 * seven-digit string.
 */
export function hexFromUnitRgb(red: number, green: number, blue: number): string {
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function channel(value: number): string {
  const scaled = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return scaled.toString(16).padStart(2, "0");
}
