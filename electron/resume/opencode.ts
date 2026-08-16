/**
 * `<home>/.local/share/opencode/storage/session/<bucket>/*.json` → resumable
 * opencode sessions. Each file is one small session object, not a
 * newline-delimited transcript, so unlike the Claude/Codex scanners this one
 * parses the head window as a single JSON value.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { headBytes, type CandidateSession } from "./head";

const OPENCODE_SESSION_DIR = path.join(
  ".local",
  "share",
  "opencode",
  "storage",
  "session",
);

/** A session object is metadata, not conversation content — generous enough
 * to hold one whole file, small enough that an oversized/corrupt file is
 * simply skipped as unparseable rather than read in full. */
const HEAD_BYTES = 256 * 1024;

/** Newest-first scan bound, same rationale as the Claude/Codex scanners. */
const MAX_FILES = 300;

function isRegularFile(candidate: string): boolean {
  try {
    return lstatSync(candidate, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return (
      lstatSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true
    );
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

function sessionFiles(bucketDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(bucketDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(bucketDir, name))
    .filter(isRegularFile);
}

interface DatedFile {
  readonly filePath: string;
  readonly mtimeMs: number;
}

function datedSessions(root: string): DatedFile[] {
  const out: DatedFile[] = [];
  for (const bucket of bucketDirs(root)) {
    for (const filePath of sessionFiles(bucket)) {
      try {
        out.push({ filePath, mtimeMs: lstatSync(filePath).mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return out;
}

function readCandidate(entry: DatedFile): CandidateSession | null {
  const head = headBytes(entry.filePath, HEAD_BYTES);
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
  const node = value as Record<string, unknown>;
  const id = node.id;
  if (typeof id !== "string" || id === "") {
    return null;
  }
  const directory = node.directory;
  const cwd =
    typeof directory === "string" && directory !== "" ? directory : null;
  const time = node.time;
  const updated =
    time !== null && typeof time === "object"
      ? (time as Record<string, unknown>).updated
      : undefined;
  const mtimeMs = typeof updated === "number" ? updated : entry.mtimeMs;
  return { id, cwd, mtimeMs };
}

export function candidates(home: string): CandidateSession[] {
  const root = path.join(home, OPENCODE_SESSION_DIR);
  const newestFirst = datedSessions(root).sort(
    (left, right) => right.mtimeMs - left.mtimeMs,
  );
  const out: CandidateSession[] = [];
  for (const entry of newestFirst.slice(0, MAX_FILES)) {
    const candidate = readCandidate(entry);
    if (candidate !== null) {
      out.push(candidate);
    }
  }
  return out;
}
