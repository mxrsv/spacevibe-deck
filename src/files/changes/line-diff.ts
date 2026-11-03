/**
 * A unified line diff of two texts, for the dock's stack of file cards (DOCK-10): hunks with
 * context, from a Myers shortest-edit-script. Pure and dependency-free, so no Monaco instance is
 * needed per file.
 *
 * Line endings are normalised (CRLF reads as LF) and a missing final newline is not a change.
 * A diff with more changed lines than `maxChanges` answers `tooLarge` instead of hunks, so one
 * rewritten file can neither freeze the UI nor mount thousands of rows.
 */

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

export interface DiffHunk {
  /** 1-based first line in the original; the line before the hunk when it holds no old line. */
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export interface LineDiff {
  readonly hunks: readonly DiffHunk[];
  /** More changed lines than the cap: `hunks` is empty and the caller prints a note. */
  readonly tooLarge: boolean;
}

export const DEFAULT_CONTEXT = 3;
/** Changed lines (added plus removed) past which a diff is not worth drawing in a card. */
export const MAX_CHANGED_LINES = 2000;

function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Myers' O(ND) walk; null once the edit distance passes `max`. */
function shortestEdit(a: readonly string[], b: readonly string[], max: number): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, max);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  // trace[d] holds v as it stood before round d, for the diagonals -d-1..d+1.
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= limit && !found; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) {
    return null;
  }
  const out: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const before = trace[d];
    const at = (k: number): number => before[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ kind: "context", text: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      out.push(x === prevX ? { kind: "add", text: b[prevY] } : { kind: "del", text: a[prevX] });
    }
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

function commonEnds(a: readonly string[], b: readonly string[]): { head: number; tail: number } {
  const shortest = Math.min(a.length, b.length);
  let head = 0;
  while (head < shortest && a[head] === b[head]) {
    head += 1;
  }
  let tail = 0;
  while (tail < shortest - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1;
  }
  return { head, tail };
}

const asLines = (kind: DiffLineKind, texts: readonly string[]): DiffLine[] =>
  texts.map((text) => ({ kind, text }));

/** The whole edit script, equal lines included; null when it exceeds `max` changes. */
function editScript(a: readonly string[], b: readonly string[], max: number): DiffLine[] | null {
  const { head, tail } = commonEnds(a, b);
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  let middle: DiffLine[] | null;
  if (midA.length === 0 || midB.length === 0) {
    middle = [...asLines("del", midA), ...asLines("add", midB)];
    middle = middle.length > max ? null : middle;
  } else {
    middle = shortestEdit(midA, midB, max);
  }
  if (middle === null) {
    return null;
  }
  return [
    ...asLines("context", a.slice(0, head)),
    ...middle,
    ...asLines("context", a.slice(a.length - tail)),
  ];
}

function hunksOf(script: readonly DiffLine[], context: number): DiffHunk[] {
  const changed: number[] = [];
  script.forEach((line, index) => {
    if (line.kind !== "context") {
      changed.push(index);
    }
  });
  if (changed.length === 0) {
    return [];
  }
  // Running line counts before each script index, to number a hunk's first lines.
  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const line of script) {
    oldBefore.push(oldCount);
    newBefore.push(newCount);
    oldCount += line.kind === "add" ? 0 : 1;
    newCount += line.kind === "del" ? 0 : 1;
  }
  const hunks: DiffHunk[] = [];
  let from = Math.max(0, changed[0] - context);
  let to = Math.min(script.length, changed[0] + context + 1);
  const close = (): void => {
    const lines = script.slice(from, to);
    const oldLines = lines.filter((line) => line.kind !== "add").length;
    const newLines = lines.filter((line) => line.kind !== "del").length;
    hunks.push({
      oldStart: oldLines === 0 ? oldBefore[from] : oldBefore[from] + 1,
      oldLines,
      newStart: newLines === 0 ? newBefore[from] : newBefore[from] + 1,
      newLines,
      lines,
    });
  };
  for (const index of changed.slice(1)) {
    if (index - context <= to) {
      to = Math.min(script.length, index + context + 1);
    } else {
      close();
      from = Math.max(0, index - context);
      to = Math.min(script.length, index + context + 1);
    }
  }
  close();
  return hunks;
}

export function diffLines(
  original: string,
  modified: string,
  context: number = DEFAULT_CONTEXT,
  maxChanges: number = MAX_CHANGED_LINES,
): LineDiff {
  const script = editScript(splitLines(original), splitLines(modified), maxChanges);
  return script === null
    ? { hunks: [], tooLarge: true }
    : { hunks: hunksOf(script, context), tooLarge: false };
}
