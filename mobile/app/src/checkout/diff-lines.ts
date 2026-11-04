export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

const META =
  /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename (from|to) |Binary files )/;

/**
 * Classifies each line of a unified diff for colouring. Before the first hunk, header lines are
 * `meta`; after it a line is judged by its first character, so a removed line that happens to
 * start with `--` is still a removal. The desktop's synthetic diff of an untracked file has one
 * `+++ path` header and then added lines without a hunk header; only that first `+++ ` is meta.
 */
export function classifyDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let inHunk = false;
  let sawNewHeader = false;
  return lines.map((text): DiffLine => {
    if (text.startsWith("@@")) {
      inHunk = true;
      return { kind: "hunk", text };
    }
    if (!inHunk) {
      if (text.startsWith("+++ ") && !sawNewHeader) {
        sawNewHeader = true;
        return { kind: "meta", text };
      }
      if (META.test(text) && !text.startsWith("+++ ")) return { kind: "meta", text };
    }
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "remove", text };
    if (text.startsWith("\\")) return { kind: "meta", text }; // "\ No newline at end of file"
    return { kind: "context", text };
  });
}

/** The longest line, in characters, capped so one minified line cannot make the view absurdly wide. */
export function widestLine(lines: readonly DiffLine[], cap = 400): number {
  return Math.min(
    cap,
    lines.reduce((max, line) => Math.max(max, line.text.length), 0),
  );
}
