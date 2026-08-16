/**
 * `<home>/.claude/projects/<project>/*.jsonl` → resumable Claude sessions.
 *
 * Files directly in a project directory only — a `<session>/subagents/`
 * transcript is a sub-conversation the top-level session drove, not a
 * conversation a terminal pane resumes into, so unlike
 * `electron/usage/discover.ts`'s counter this scanner never descends there.
 */
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  IDENTITY_HEAD_BYTES,
} from "../usage/model";
import {
  headBytes,
  headJsonLines,
  normalizeTitle,
  type CandidateSession,
  type FileCandidate,
  type ScanOptions,
  type ScanResult,
  type SessionRecord,
} from "./head";

/**
 * `sessionId` is on line one; `cwd` lands within the first few lines (line 5
 * on this machine's corpus, measured 2026-08-16) and the first real user turn
 * within the first ten. 64 KiB / 60 lines covers all three.
 */
export const CLAUDE_RESTORE_SCAN: ScanOptions = Object.freeze({
  maxFiles: 300,
  headBytes: IDENTITY_HEAD_BYTES,
  headLines: 60,
  withTitle: false,
});

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

function projectDirs(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.map((name) => path.join(root, name)).filter(isDirectory);
}

function transcriptFiles(projectDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(projectDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(projectDir, name))
    .filter(isRegularFile);
}

function datedTranscripts(root: string): FileCandidate[] {
  const out: FileCandidate[] = [];
  for (const project of projectDirs(root)) {
    for (const filePath of transcriptFiles(project)) {
      try {
        const info = lstatSync(filePath);
        out.push({ filePath, mtimeMs: info.mtimeMs, size: info.size });
      } catch {
        continue;
      }
    }
  }
  return out;
}

/**
 * A `type: "user"` line whose content is a tool result is the transcript
 * echoing a tool back, not something the user typed. Only a plain string, or
 * a `{ type: "text" }` part, is user-authored.
 */
function claudeUserText(line: Record<string, unknown>): string | null {
  if (line.type !== "user") {
    return null;
  }
  const message = line.message;
  if (message === null || typeof message !== "object") {
    return null;
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  for (const part of content) {
    if (part === null || typeof part !== "object") {
      continue;
    }
    const node = part as Record<string, unknown>;
    if (node.type === "text" && typeof node.text === "string") {
      return node.text;
    }
  }
  return null;
}

export function readClaudeRecord(
  entry: FileCandidate,
  options: ScanOptions,
): SessionRecord | null {
  const head = headBytes(entry.filePath, options.headBytes);
  if (head === null) {
    return null;
  }
  const lines = headJsonLines(head, options.headLines);
  const first = lines[0];
  if (first === null || typeof first !== "object") {
    return null;
  }
  const sessionId = (first as Record<string, unknown>).sessionId;
  if (typeof sessionId !== "string" || sessionId === "") {
    return null;
  }
  let cwd: string | null = null;
  let title: string | null = null;
  for (const line of lines) {
    if (line === null || typeof line !== "object") {
      continue;
    }
    const node = line as Record<string, unknown>;
    if (cwd === null && typeof node.cwd === "string" && node.cwd !== "") {
      cwd = node.cwd;
    }
    if (options.withTitle && title === null) {
      const text = claudeUserText(node);
      if (text !== null) {
        title = normalizeTitle(text);
      }
    }
    if (cwd !== null && (!options.withTitle || title !== null)) {
      break;
    }
  }
  return {
    id: sessionId,
    cwd,
    mtimeMs: entry.mtimeMs,
    sourcePath: entry.filePath,
    title,
  };
}

/** Every transcript, newest first, stat only — no file is opened here. */
export function listClaudeFiles(home: string): FileCandidate[] {
  const root = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR);
  return datedTranscripts(root).sort(
    (left, right) => right.mtimeMs - left.mtimeMs,
  );
}

/** List + cap + read, with no cache. The boot path's shape; the history
 *  surface uses `listClaudeFiles` + `readClaudeRecord` so it can skip reads. */
export function scanClaude(home: string, options: ScanOptions): ScanResult {
  const newestFirst = listClaudeFiles(home);
  const records: SessionRecord[] = [];
  for (const entry of newestFirst.slice(0, options.maxFiles)) {
    const record = readClaudeRecord(entry, options);
    if (record !== null) {
      records.push(record);
    }
  }
  return { total: newestFirst.length, records };
}

/** The boot path's shape, unchanged: ids and cwds, no titles. */
export function candidates(home: string): CandidateSession[] {
  return scanClaude(home, CLAUDE_RESTORE_SCAN).records.slice();
}
