/**
 * Reads a worker's final envelope (spec ORC21) out of a pane's plain-text scrollback.
 *
 * Terminal UIs decorate output: one opens a reply with `⏺ ` and indents the lines after it,
 * others draw a `│ ` or `> ` gutter. So each line first loses its leading run of characters
 * that are not a letter, digit or `_`. A header must then be the whole line and a key must
 * start it, so a header inside a longer word, or followed by text, is not a header.
 *
 * The last header wins and is never completed from an earlier block, so a half-written block
 * reads as "no envelope yet" rather than as the previous task's result. The one exception is a
 * placeholder block (`task: <task id>`): that is the brief's template echoed on screen, not a
 * result, so it is skipped and the search goes on to the header before it.
 */

export const WORKER_DONE_HEADER = "DECK_WORKER_DONE";
export const WORKER_BLOCKED_HEADER = "DECK_WORKER_BLOCKED";

const DONE_KEYS = ["task", "summary", "files", "checks", "handoff"] as const;
const BLOCKED_KEYS = ["task", "reason", "needs"] as const;

export type WorkerEnvelope =
  | {
      kind: "done";
      task: string;
      summary: string;
      files: string;
      checks: string;
      handoff: string;
    }
  | { kind: "blocked"; task: string; reason: string; needs: string };

const GUTTER = /^[^\p{L}\p{N}_]+/u;

const stripGutter = (line: string): string => line.replace(GUTTER, "").trimEnd();

/** `<task id>` is the brief's template echoed on screen, not a task. */
const isPlaceholder = (task: string | undefined): boolean =>
  task !== undefined && task.startsWith("<") && task.endsWith(">");

/**
 * The `key: value` lines that open `lines`, in any order, each key once. The first line that
 * is not an unseen key of the block ends it.
 */
function readFields<K extends string>(
  lines: string[],
  keys: readonly K[],
): Partial<Record<K, string>> {
  const found: Partial<Record<K, string>> = {};
  for (const line of lines) {
    const key = keys.find((k) => found[k] === undefined && line.startsWith(`${k}:`));
    if (key === undefined) break;
    found[key] = line.slice(key.length + 1).trim();
  }
  return found;
}

function isComplete<K extends string>(
  found: Partial<Record<K, string>>,
  keys: readonly K[],
): found is Record<K, string> {
  return keys.every((k) => found[k] !== undefined);
}

/** The block under the last real header in `text`, or null when it is absent or incomplete. */
export function parseWorkerEnvelope(text: string): WorkerEnvelope | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(stripGutter);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === WORKER_DONE_HEADER) {
      const fields = readFields(lines.slice(i + 1), DONE_KEYS);
      if (isPlaceholder(fields.task)) continue;
      return isComplete(fields, DONE_KEYS) ? { kind: "done", ...fields } : null;
    }
    if (lines[i] === WORKER_BLOCKED_HEADER) {
      const fields = readFields(lines.slice(i + 1), BLOCKED_KEYS);
      if (isPlaceholder(fields.task)) continue;
      return isComplete(fields, BLOCKED_KEYS) ? { kind: "blocked", ...fields } : null;
    }
  }
  return null;
}
