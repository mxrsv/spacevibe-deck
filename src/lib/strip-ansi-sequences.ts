/**
 * Plain text out of a terminal buffer (Agent Board spec §7.3, DL-34.6). The
 * serialize addon emits SGR and other control sequences; the panel wants the
 * words. CSI `ESC [ … final`, OSC `ESC ] … (BEL | ESC \)`, every other
 * two-byte `ESC x`, and `\r` are dropped; `\n` and `\t` survive.
 */
const SEQUENCE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b\([A-Za-z0-9]|\r/g;

export function stripAnsiSequences(text: string): string {
  return text.replace(SEQUENCE, "");
}

/** The last `rows` lines of `text`, trailing blank lines trimmed first. */
export function lastRows(text: string, rows: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - rows), end).join("\n");
}
