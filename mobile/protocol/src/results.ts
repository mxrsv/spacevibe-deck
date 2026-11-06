/**
 * Typed, sanitising parsers for the `r` of a successful response, one per method. `parseResponse`
 * only checks the envelope because it cannot know which request a response answers; the caller
 * does, and passes the method here.
 */
import { displayText } from "./display-text";
import type { Method } from "./messages";
import {
  parseAgentChoices,
  parseProjectChoices,
  parseTree,
  type ProjectChoice,
  type Tree,
} from "./tree";
import {
  isIntegerIn,
  isRecord,
  isSafeNonNegative,
  oneOf,
  parseList,
  type JsonObject,
} from "./validate";

/** A body too large for one message: join the `chunk` events with this id (see `chunk.ts`). */
export interface Chunked {
  readonly chunked: string;
  readonly truncated?: boolean;
  readonly binary?: boolean;
}
export interface FileEntry {
  readonly name: string;
  readonly kind: "file" | "dir";
  readonly size: number;
}
export interface ChangeEntry {
  readonly path: string;
  readonly status: string;
  readonly added: number;
  readonly removed: number;
}
/** The numbers the desktop's usage tab shows; the desktop owns the shape, the phone renders what it knows. */
export type UsageSummary = JsonObject;

type Empty = Record<string, never>;

export interface MethodResults {
  "tree.subscribe": { tree: Tree };
  "tree.unsubscribe": Empty;
  "pane.subscribe": { sub: string; cols: number; rows: number };
  "pane.unsubscribe": Empty;
  "pane.input": Empty;
  "pane.send": { outcome: string };
  "pane.read": { text: string } | Chunked;
  "pane.open": { paneId: number };
  "projects.list": { projects: ProjectChoice[] };
  "agents.list": { agents: { id: string; label: string }[] };
  "files.list": { entries: FileEntry[] };
  "files.read":
    | { text: string; truncated: boolean; binary: boolean }
    | (Chunked & { truncated: boolean; binary: boolean });
  "changes.list": { changes: ChangeEntry[] };
  "changes.diff": { diff: string } | Chunked;
  "usage.get": { usage: UsageSummary };
}

const MAX_ENTRIES = 5000;

function chunked(r: JsonObject): Chunked | null {
  if (typeof r.chunked !== "string" || r.chunked.length < 1 || r.chunked.length > 64) return null;
  return { chunked: r.chunked };
}

function parseEntry(value: unknown): FileEntry | null {
  if (!isRecord(value) || typeof value.name !== "string" || !isSafeNonNegative(value.size)) {
    return null;
  }
  const kind = oneOf(["file", "dir"] as const, value.kind);
  const name = displayText(value.name, 255);
  return kind === null || name === "" ? null : { name, kind, size: value.size };
}

function parseChange(value: unknown): ChangeEntry | null {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.status !== "string" ||
    !isSafeNonNegative(value.added) ||
    !isSafeNonNegative(value.removed)
  ) {
    return null;
  }
  return {
    path: displayText(value.path, 1024),
    status: displayText(value.status, 16),
    added: value.added,
    removed: value.removed,
  };
}

type ResultParsers = { [M in Method]: (r: JsonObject) => MethodResults[M] | null };

const RESULT_PARSERS: ResultParsers = {
  "tree.subscribe": (r) => {
    const tree = parseTree(r.tree);
    return tree === null ? null : { tree };
  },
  "tree.unsubscribe": () => ({}),
  "pane.subscribe": (r) =>
    typeof r.sub === "string" &&
    r.sub.length >= 1 &&
    r.sub.length <= 64 &&
    isIntegerIn(r.cols, 1, 1000) &&
    isIntegerIn(r.rows, 1, 1000)
      ? { sub: r.sub, cols: r.cols, rows: r.rows }
      : null,
  "pane.unsubscribe": () => ({}),
  "pane.input": () => ({}),
  "pane.send": (r) =>
    typeof r.outcome === "string" ? { outcome: displayText(r.outcome, 64) } : null,
  "pane.read": (r) => (typeof r.text === "string" ? { text: r.text } : chunked(r)),
  "pane.open": (r) => (isSafeNonNegative(r.paneId) ? { paneId: r.paneId } : null),
  "projects.list": (r) => {
    const projects = parseProjectChoices(r.projects);
    return projects === null ? null : { projects };
  },
  "agents.list": (r) => {
    const agents = parseAgentChoices(r.agents);
    return agents === null ? null : { agents };
  },
  "files.list": (r) => {
    const entries = parseList(r.entries, MAX_ENTRIES, parseEntry);
    return entries === null ? null : { entries };
  },
  "files.read": (r) => {
    if (typeof r.truncated !== "boolean" || typeof r.binary !== "boolean") return null;
    if (typeof r.text === "string") {
      return { text: r.text, truncated: r.truncated, binary: r.binary };
    }
    const body = chunked(r);
    return body === null ? null : { ...body, truncated: r.truncated, binary: r.binary };
  },
  "changes.list": (r) => {
    const changes = parseList(r.changes, MAX_ENTRIES, parseChange);
    return changes === null ? null : { changes };
  },
  "changes.diff": (r) => (typeof r.diff === "string" ? { diff: r.diff } : chunked(r)),
  "usage.get": (r) => (isRecord(r.usage) ? { usage: r.usage } : null),
};

/** The typed result for `method`, or null when the desktop's answer is not of that shape. */
export function parseResult<M extends Method>(method: M, r: unknown): MethodResults[M] | null {
  return isRecord(r) ? RESULT_PARSERS[method](r) : null;
}
