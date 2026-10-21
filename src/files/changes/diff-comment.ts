/**
 * Where a diff comment points and the one line that carries it (spec
 * 2026-10-21-diff-line-comments, DLC3–5).
 *
 * Pure: the diff column hands in a side, the selected lines and Monaco's line
 * changes, and gets back what the agent should read. The agent reads the working
 * tree, so lines are named by new-file numbers wherever the selection has one.
 */
import type { ChangeEntry } from "../../host/git-changes-host";
import { stripAnsiSequences } from "../../lib/strip-ansi-sequences";
import { sanitizeTerminalPaste } from "../../lib/terminal-paste";

export type DiffSide = "original" | "modified";

/** Monaco's `ILineChange`: an end of 0 means that side has no lines in the change. */
export interface LineChange {
  readonly originalStartLineNumber: number;
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedEndLineNumber: number;
}

export interface CommentLocation {
  /** Root-relative with `/`. */
  readonly path: string;
  readonly from: number;
  readonly to: number;
  /** Printed after the range, or null. */
  readonly suffix: string | null;
}

export interface LineSelection {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export interface CommentLocationInput {
  readonly entry: Pick<ChangeEntry, "path" | "oldPath" | "status">;
  readonly side: DiffSide;
  /** 1-based, inclusive, in the numbering of `side`. */
  readonly from: number;
  readonly to: number;
  readonly changes: readonly LineChange[];
}

const DELETED_SUFFIX = "(deleted lines)";
const ACROSS_SUFFIX = "(across deletions and additions)";

/** The lines a Monaco selection covers: a selection ending at column 1 stops short of that line. */
export function selectedLines(selection: LineSelection): { from: number; to: number } {
  const forward =
    selection.startLineNumber < selection.endLineNumber ||
    (selection.startLineNumber === selection.endLineNumber &&
      selection.startColumn <= selection.endColumn);
  const [startLine, endLine, endColumn] = forward
    ? [selection.startLineNumber, selection.endLineNumber, selection.endColumn]
    : [selection.endLineNumber, selection.startLineNumber, selection.startColumn];
  const to = endLine > startLine && endColumn === 1 ? endLine - 1 : endLine;
  return { from: startLine, to };
}

const hasOriginal = (change: LineChange): boolean => change.originalEndLineNumber > 0;
const hasModified = (change: LineChange): boolean => change.modifiedEndLineNumber > 0;

function originalLength(change: LineChange): number {
  return hasOriginal(change)
    ? change.originalEndLineNumber - change.originalStartLineNumber + 1
    : 0;
}

function modifiedLength(change: LineChange): number {
  return hasModified(change)
    ? change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
    : 0;
}

/** The change that deletes or replaces old line `line`, if any. */
function changeCovering(changes: readonly LineChange[], line: number): LineChange | null {
  return (
    changes.find(
      (change) =>
        hasOriginal(change) &&
        line >= change.originalStartLineNumber &&
        line <= change.originalEndLineNumber,
    ) ?? null
  );
}

/** New-file number of an old line no change touches. */
function newNumberOf(changes: readonly LineChange[], line: number): number {
  let shift = 0;
  for (const change of changes) {
    const before = hasOriginal(change)
      ? change.originalEndLineNumber < line
      : change.originalStartLineNumber < line;
    if (before) {
      shift += modifiedLength(change) - originalLength(change);
    }
  }
  return line + shift;
}

function originalSideLocation(input: CommentLocationInput): CommentLocation {
  const { entry, changes, from, to } = input;
  const deletedPath = entry.status === "renamed" ? (entry.oldPath ?? entry.path) : entry.path;
  const deleted: LineChange[] = [];
  const kept: number[] = [];
  for (let line = from; line <= to; line += 1) {
    const change = entry.status === "deleted" ? null : changeCovering(changes, line);
    if (entry.status !== "deleted" && change === null) {
      kept.push(newNumberOf(changes, line));
    } else if (change !== null && !deleted.includes(change)) {
      deleted.push(change);
    }
  }
  if (kept.length === 0) {
    return { path: deletedPath, from, to, suffix: DELETED_SUFFIX };
  }
  const touched = [
    ...kept,
    ...deleted
      .filter(hasModified)
      .flatMap((change) => [change.modifiedStartLineNumber, change.modifiedEndLineNumber]),
  ];
  const range = { path: entry.path, from: Math.min(...touched), to: Math.max(...touched) };
  const crossed = to - from + 1 > kept.length;
  return { ...range, suffix: crossed ? ACROSS_SUFFIX : null };
}

export function commentLocation(input: CommentLocationInput): CommentLocation {
  if (input.side === "modified") {
    return { path: input.entry.path, from: input.from, to: input.to, suffix: null };
  }
  return originalSideLocation(input);
}

/** One line of text: escape sequences and controls gone, line breaks folded to a space. */
function oneLine(text: string): string {
  return sanitizeTerminalPaste(stripAnsiSequences(text))
    .replace(/\s*[\n\u2028\u2029]\s*/g, " ")
    .trim();
}

/** The DLC4 payload, or null when the comment says nothing. */
export function formatComment(location: CommentLocation, comment: string): string | null {
  const body = oneLine(comment);
  if (body === "") {
    return null;
  }
  const lines =
    location.from === location.to ? `L${location.from}` : `L${location.from}-L${location.to}`;
  const suffix = location.suffix === null ? "" : ` ${location.suffix}`;
  return `${oneLine(`In ${location.path}:${lines}${suffix}`)}: ${body}`;
}
