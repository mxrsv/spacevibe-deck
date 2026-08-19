/**
 * Where the transcripts are, and which session each file belongs to.
 * Port of `src-tauri/src/usage/discover.rs`.
 */
import { closeSync, lstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  CLAUDE_SUBAGENTS_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_DIR,
  CODEX_ROLLOUT_PREFIX,
  CODEX_SESSIONS_DIR,
  IDENTITY_HEAD_BYTES,
  MAX_WALK_DEPTH,
  TRANSCRIPT_EXTENSION,
} from "./model";

/**
 * Up to `cap` bytes of a file, truncated at the first newline.
 *
 * Deliberately bounded: a subagent transcript opens with a `type: "user"`
 * line that can carry a pasted blob, and an unbounded read here would
 * reintroduce exactly the hazard the capped line reader exists to remove.
 */
function readFirstLine(filePath: string, cap: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const head = Buffer.alloc(cap);
    const read = readSync(fd, head, 0, cap, 0);
    const window = head.subarray(0, read);
    const newlineAt = window.indexOf(0x0a);
    return Buffer.from(newlineAt === -1 ? window : window.subarray(0, newlineAt));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * FNV-1a, 64-bit. Not a security hash — it exists so a file whose first line
 * names no session still gets a stable, content-free identity.
 */
export function fnv1a64(bytes: Buffer): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x00000100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

/**
 * A file's session identity, from its first line.
 *
 * Claude writes `sessionId` on every line including the first; Codex writes
 * `payload.id` (and the identical `payload.session_id`) on its `session_meta`
 * line. When neither is there the fallback is a **hash** of the head, never
 * the head itself: the cache must not store conversation bytes (privacy
 * contract).
 */
export function identityFromHead(head: Buffer): string {
  let value: unknown;
  try {
    value = JSON.parse(head.toString("utf8"));
  } catch {
    value = null;
  }
  if (value !== null && typeof value === "object") {
    const node = value as Record<string, unknown>;
    const payload =
      node.payload !== null && typeof node.payload === "object"
        ? (node.payload as Record<string, unknown>)
        : undefined;
    const named = [node.sessionId, payload?.id, payload?.session_id].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate !== "",
    );
    if (named !== undefined) {
      return named;
    }
  }
  return `h:${fnv1a64(head).toString(16).padStart(16, "0")}`;
}

export function fileIdentity(filePath: string): string | null {
  const head = readFirstLine(filePath, IDENTITY_HEAD_BYTES);
  return head === null ? null : identityFromHead(head);
}

/** Whether a source root could be looked at, before anything was read. */
export type DiscoveryState = "missing" | "unreadable" | "present";

export interface Discovery {
  files: string[];
  state: DiscoveryState;
}

export interface CodexDiscovery {
  active: string[];
  archived: string[];
  state: DiscoveryState;
}

/**
 * `lstat`, so symlinks are refused rather than followed — one can point
 * straight out of the scanned tree, and a symlinked directory could build a
 * walk loop.
 */
function entryKind(dir: string, name: string): { file: boolean; dir: boolean } {
  try {
    const info = lstatSync(path.join(dir, name), { throwIfNoEntry: false });
    if (info === undefined) {
      return { file: false, dir: false };
    }
    return { file: info.isFile(), dir: info.isDirectory() };
  } catch {
    return { file: false, dir: false };
  }
}

/**
 * Regular, non-symlinked entries of `dir` matching `prefix` (when given) and
 * the transcript extension. Returns false when the directory is unlistable.
 */
function pushTranscripts(dir: string, prefix: string | null, out: string[]): boolean {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name.endsWith(TRANSCRIPT_EXTENSION)) {
      continue;
    }
    if (prefix !== null && !name.startsWith(prefix)) {
      continue;
    }
    if (!entryKind(dir, name).file) {
      continue;
    }
    out.push(path.join(dir, name));
  }
  return true;
}

/** Directory entries of `dir` that are real directories, sorted. */
function childDirs(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const dirs = names.filter((name) => entryKind(dir, name).dir).map((name) => path.join(dir, name));
  dirs.sort();
  return dirs;
}

function exists(target: string): boolean {
  try {
    return statSync(target, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/**
 * `<home>/.claude/projects/<project>/<session>.jsonl` and everything under
 * `<home>/.claude/projects/<project>/<session>/subagents/`, at any depth up
 * to the cap.
 *
 * Both globs, not just the first: subagent transcripts are ~47% of the dev
 * machine's Claude history by size, and omitting them undercounts by almost
 * half. Recursive because `subagents/workflows/<id>/` nests one level deeper
 * than the flat `subagents/<agent>.jsonl` the first draft assumed.
 */
export function discoverClaude(home: string): Discovery {
  const root = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR);
  if (!exists(root)) {
    return { files: [], state: "missing" };
  }
  let projectNames: string[];
  try {
    projectNames = readdirSync(root);
  } catch {
    return { files: [], state: "unreadable" };
  }
  const files: string[] = [];
  const projectDirs = projectNames
    .filter((name) => entryKind(root, name).dir)
    .map((name) => path.join(root, name));
  projectDirs.sort();
  for (const project of projectDirs) {
    pushTranscripts(project, null, files);
    for (const session of childDirs(project)) {
      walkSubagents(path.join(session, CLAUDE_SUBAGENTS_DIR), 0, files);
    }
  }
  files.sort();
  return { files, state: "present" };
}

/**
 * Every transcript under a `subagents/` directory, at any depth up to the
 * cap. Symlinked directories are never descended (see `entryKind`), so a
 * loop cannot be built out of them either.
 */
function walkSubagents(dir: string, depth: number, out: string[]): void {
  if (depth > MAX_WALK_DEPTH) {
    return;
  }
  pushTranscripts(dir, null, out);
  for (const child of childDirs(dir)) {
    walkSubagents(child, depth + 1, out);
  }
}

/**
 * Every `rollout-*.jsonl` under a Codex root, at any depth up to the cap.
 * Symlinked directories are never descended, so a loop cannot be built out
 * of them either.
 */
function walkRollouts(dir: string, depth: number, out: string[]): boolean {
  if (depth > MAX_WALK_DEPTH) {
    return true;
  }
  if (!pushTranscripts(dir, CODEX_ROLLOUT_PREFIX, out)) {
    return false;
  }
  for (const child of childDirs(dir)) {
    walkRollouts(child, depth + 1, out);
  }
  return true;
}

/**
 * Every rollout under `<home>/.codex/sessions` and
 * `<home>/.codex/archived_sessions`, recursively. Missing only when BOTH
 * roots are absent — a machine that has archived sessions but no live ones
 * still has data to show.
 */
export function discoverCodex(home: string): CodexDiscovery {
  const base = path.join(home, CODEX_DIR);
  const live = path.join(base, CODEX_SESSIONS_DIR);
  const old = path.join(base, CODEX_ARCHIVED_DIR);
  const liveExists = exists(live);
  const oldExists = exists(old);
  if (!liveExists && !oldExists) {
    return { active: [], archived: [], state: "missing" };
  }
  const active: string[] = [];
  const archived: string[] = [];
  let readable = false;
  if (liveExists && walkRollouts(live, 0, active)) {
    readable = true;
  }
  if (oldExists && walkRollouts(old, 0, archived)) {
    readable = true;
  }
  active.sort();
  archived.sort();
  return { active, archived, state: readable ? "present" : "unreadable" };
}
