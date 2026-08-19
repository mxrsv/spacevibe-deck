/**
 * opencode's resumable sessions and their newest sentence, across BOTH install
 * layouts.
 *
 * Up to 1.17 opencode kept its state in a json tree under
 * `<home>/.local/share/opencode/storage/` — session objects in
 * `session/<bucket>/*.json`, turns in `message/<sessionID>/`, words in
 * `part/<messageID>/`. 1.18 moved all of it into a SQLite database
 * ([`opencode-db.ts`](./opencode-db.ts)) with the ids and the json shapes
 * unchanged, and left the old tree on disk untouched. Reading only the tree is
 * therefore SILENTLY empty on a current install — its newest file can be hours
 * stale while panes are answering — which is exactly how this was found
 * (2026-08-17).
 *
 * So both are read and merged here, database first. The scanners below are the
 * legacy half; they still matter for an install that never migrated, and their
 * ids are the same ids, so a session present in both is one candidate, not two.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import * as db from "./opencode-db";
import { headBytes, type CandidateSession } from "./head";

const OPENCODE_STORAGE_DIR = path.join(".local", "share", "opencode", "storage");

const OPENCODE_SESSION_DIR = path.join(OPENCODE_STORAGE_DIR, "session");

/** `message/<sessionID>/<messageID>.json` — role and timing, no words. */
const OPENCODE_MESSAGE_DIR = path.join(OPENCODE_STORAGE_DIR, "message");

/** `part/<messageID>/<partID>.json` — where the words actually live. */
const OPENCODE_PART_DIR = path.join(OPENCODE_STORAGE_DIR, "part");

/** A session object is metadata, not conversation content — generous enough
 * to hold one whole file, small enough that an oversized/corrupt file is
 * simply skipped as unparseable rather than read in full. */
const HEAD_BYTES = 256 * 1024;

/**
 * Message and part objects get the SAME budget as a session object, and a
 * smaller one would be a silent bug: a head window that cuts a JSON value in
 * half fails to parse, and the walk below would step past that turn to an older
 * one — showing a stale sentence rather than nothing. A message is role +
 * timing in the common case, but it also carries `summary.diffs`, and the
 * owner's corpus has 304 messages over 8 KiB with the largest at ~106 KiB.
 */
const MESSAGE_HEAD_BYTES = HEAD_BYTES;
const PART_HEAD_BYTES = HEAD_BYTES;

/** Newest-first scan bound, same rationale as the Claude/Codex scanners. */
const MAX_FILES = 300;

/**
 * Bounds for the tail walk. A turn is a handful of parts and a rail row only
 * ever shows the newest of them, so both walks stop long before a long session
 * is read in full.
 */
const MAX_TAIL_MESSAGES = 40;
const MAX_TAIL_PARTS = 60;

/**
 * Ids come out of files opencode wrote, and both are pasted straight into a
 * path — so they are external input at a boundary (C7). Anything but the
 * `ses_…`/`msg_…` alphabet is refused rather than sanitized, which is what
 * keeps a crafted `..` id from walking the scan out of the storage directory.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isRegularFile(candidate: string): boolean {
  try {
    return lstatSync(candidate, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return lstatSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

function bucketDirs(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.map((name) => path.join(root, name)).filter(isDirectory);
}

function jsonFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(dir, name))
    .filter(isRegularFile);
}

interface DatedFile {
  readonly filePath: string;
  readonly mtimeMs: number;
}

function dated(filePaths: readonly string[]): DatedFile[] {
  const out: DatedFile[] = [];
  for (const filePath of filePaths) {
    try {
      out.push({ filePath, mtimeMs: lstatSync(filePath).mtimeMs });
    } catch {
      continue;
    }
  }
  return out;
}

/** Every `.json` directly inside `dir`, newest mtime first. A missing or
 *  unreadable directory is an empty list, never a throw. */
function newestFirstIn(dir: string): DatedFile[] {
  // Sorting the copy `dated` just built, not a shared array (C1).
  return dated(jsonFiles(dir)).sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function datedSessions(root: string): DatedFile[] {
  const out: DatedFile[] = [];
  for (const bucket of bucketDirs(root)) {
    out.push(...dated(jsonFiles(bucket)));
  }
  return out;
}

/** One bounded head window parsed as a single JSON object, or null when the
 *  file is missing, oversized, truncated mid-value or not an object. */
function readJsonObject(filePath: string, cap: number): Record<string, unknown> | null {
  const head = headBytes(filePath, cap);
  if (head === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(head.toString("utf8"));
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readCandidate(entry: DatedFile): CandidateSession | null {
  const node = readJsonObject(entry.filePath, HEAD_BYTES);
  if (node === null) {
    return null;
  }
  const id = node.id;
  if (typeof id !== "string" || id === "") {
    return null;
  }
  const directory = node.directory;
  const cwd = typeof directory === "string" && directory !== "" ? directory : null;
  const time = node.time;
  const updated =
    time !== null && typeof time === "object"
      ? (time as Record<string, unknown>).updated
      : undefined;
  const mtimeMs = typeof updated === "number" ? updated : entry.mtimeMs;
  return { id, cwd, mtimeMs };
}

/** The pre-1.18 json tree's sessions. */
function legacyCandidates(home: string): CandidateSession[] {
  const root = path.join(home, OPENCODE_SESSION_DIR);
  const newestFirst = datedSessions(root).sort((left, right) => right.mtimeMs - left.mtimeMs);
  const out: CandidateSession[] = [];
  for (const entry of newestFirst.slice(0, MAX_FILES)) {
    const candidate = readCandidate(entry);
    if (candidate !== null) {
      out.push(candidate);
    }
  }
  return out;
}

/**
 * Every resumable opencode session, database first.
 *
 * The migration carried ids across unchanged, so the same session exists in
 * both layouts on an upgraded install — it is kept ONCE, in its database form,
 * whose `time_updated` is the live one. Two copies would defeat the greedy
 * `takenByAgent` dedup in `resolve.ts`: pane two would "match" the file copy of
 * the session pane one already took, and both panes would resume the same
 * conversation.
 */
export function candidates(home: string): CandidateSession[] {
  const fromDatabase = db.candidates(home);
  const seen = new Set(fromDatabase.map((candidate) => candidate.id));
  const out = [...fromDatabase];
  for (const candidate of legacyCandidates(home)) {
    if (!seen.has(candidate.id)) {
      seen.add(candidate.id);
      out.push(candidate);
    }
  }
  return out;
}

/**
 * The newest text one assistant message wrote, or null when it wrote none.
 *
 * `reasoning` parts carry a `text` field of their own, and `step-start`, tool
 * calls and patches carry none — so the match is on `type === "text"`
 * exactly. Matching on the presence of `text` would print the model's private
 * thinking on the rail.
 */
function newestTextPart(home: string, messageId: string): string | null {
  if (!SAFE_ID.test(messageId)) {
    return null;
  }
  const partDir = path.join(home, OPENCODE_PART_DIR, messageId);
  let read = 0;
  for (const entry of newestFirstIn(partDir)) {
    if (read >= MAX_TAIL_PARTS) {
      break;
    }
    read += 1;
    const part = readJsonObject(entry.filePath, PART_HEAD_BYTES);
    if (part === null || part.type !== "text") {
      continue;
    }
    const text = part.text;
    if (typeof text === "string" && text.trim() !== "") {
      return text;
    }
  }
  return null;
}

/**
 * The pre-1.18 tree's answer for one session.
 *
 * Where Claude and Codex keep a transcript FILE — one append-only log whose
 * end is the newest turn — this layout is a TREE: `message/<sessionID>/` holds
 * one small object per turn carrying its role but none of its words, and the
 * words sit one level down in `part/<messageID>/`. So the tail is a two-step
 * newest-first walk instead of a byte window.
 *
 * An assistant turn that only ran tools carries no sentence, so the walk
 * continues to the turn before it rather than answering with nothing — the
 * same rule `claudeTailFromLines` follows.
 *
 * Never throws: an unreadable directory, a malformed object or an id that is
 * not an id answers null.
 */
function legacySessionTailText(home: string, sessionId: string): string | null {
  if (!SAFE_ID.test(sessionId)) {
    return null;
  }
  const messageDir = path.join(home, OPENCODE_MESSAGE_DIR, sessionId);
  let read = 0;
  for (const entry of newestFirstIn(messageDir)) {
    if (read >= MAX_TAIL_MESSAGES) {
      break;
    }
    read += 1;
    const message = readJsonObject(entry.filePath, MESSAGE_HEAD_BYTES);
    if (message === null || message.role !== "assistant") {
      continue;
    }
    const id = message.id;
    if (typeof id !== "string" || id === "") {
      continue;
    }
    const text = newestTextPart(home, id);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

/**
 * The newest assistant text of one opencode session, or null.
 *
 * The database is asked first and the json tree answers only when it did not:
 * a migrated session lives in both, and the copy still being written is the
 * database one. `session-tail.ts` reads this through the same seam it reads
 * the transcript agents through, for the reason both must agree with
 * `resolve.ts` — the sentence a pane wears has to come from the session that
 * pane is running.
 */
export function sessionTailText(home: string, sessionId: string): string | null {
  return db.sessionTailText(home, sessionId) ?? legacySessionTailText(home, sessionId);
}
