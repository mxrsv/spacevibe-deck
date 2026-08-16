/**
 * `<home>/.gemini/antigravity/conversations/*.pb` → resumable Antigravity
 * (`agy`) sessions.
 *
 * The `.pb` files are protobuf, not JSON — there is no documented schema to
 * parse a `cwd` field out of, so this is deliberately best-effort: the id
 * comes from the filename, and matching a request's cwd against a candidate
 * is a raw-byte *containment* check rather than an exact-equality one.
 * Protobuf string fields are embedded as literal UTF-8 bytes on the wire, but
 * with no message layout to anchor on, a single extracted "path-shaped run"
 * routinely over-captures past the real path's end (into a URL fragment or
 * the next field's bytes) and then never string-equals the request's cwd —
 * so this scanner never extracts one. Instead it hands `resolve.ts` the
 * whole decoded head window as a `headHaystack`; `cwdMatches` there decides
 * containment. `cwd` stays `null` for every `agy` candidate; when the head
 * couldn't be read at all, `headHaystack` is left `undefined` and the
 * candidate can still be reached through the null-request-cwd, time-only
 * fallback. `resolve.ts` falls total scan failure back to
 * `{ kind: "latest" }`, since `agy --continue` needs no id at all.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { headBytes, type CandidateSession } from "./head";

const AGY_CONVERSATIONS_DIR = path.join(
  ".gemini",
  "antigravity",
  "conversations",
);
const AGY_EXTENSION = ".pb";

/** Enough of the file to plausibly contain the session's opening cwd write,
 * without reading a potentially large binary conversation blob in full. */
const HEAD_BYTES = 512 * 1024;

/** Newest-first scan bound, same rationale as the other scanners. */
const MAX_FILES = 300;

function isRegularFile(candidate: string): boolean {
  try {
    return lstatSync(candidate, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

interface DatedFile {
  readonly filePath: string;
  readonly mtimeMs: number;
}

function datedConversations(root: string): DatedFile[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: DatedFile[] = [];
  for (const name of names) {
    if (!name.endsWith(AGY_EXTENSION)) {
      continue;
    }
    const filePath = path.join(root, name);
    if (!isRegularFile(filePath)) {
      continue;
    }
    try {
      out.push({ filePath, mtimeMs: lstatSync(filePath).mtimeMs });
    } catch {
      continue;
    }
  }
  return out;
}

function readCandidate(entry: DatedFile): CandidateSession | null {
  const id = path.basename(entry.filePath, AGY_EXTENSION);
  if (id === "") {
    return null;
  }
  const head = headBytes(entry.filePath, HEAD_BYTES);
  const headHaystack = head === null ? undefined : head.toString("latin1");
  return { id, cwd: null, mtimeMs: entry.mtimeMs, headHaystack };
}

export function candidates(home: string): CandidateSession[] {
  const root = path.join(home, AGY_CONVERSATIONS_DIR);
  const newestFirst = datedConversations(root).sort(
    (left, right) => right.mtimeMs - left.mtimeMs,
  );
  return newestFirst
    .slice(0, MAX_FILES)
    .map(readCandidate)
    .filter((candidate): candidate is CandidateSession => candidate !== null);
}
