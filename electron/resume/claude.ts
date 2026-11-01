/**
 * `<home>/.claude/projects/<project>/*.jsonl` → resumable Claude sessions.
 *
 * Files directly in a project directory only — a `<session>/subagents/`
 * transcript is a sub-conversation the top-level session drove, not a
 * conversation a terminal pane resumes into, so unlike
 * `electron/usage/discover.ts`'s counter this scanner never descends there.
 */
import path from "node:path";
import { CLAUDE_DIR, CLAUDE_PROJECTS_DIR, IDENTITY_HEAD_BYTES } from "../usage/model";
import {
  childDirs,
  datedFilesIn,
  headBytes,
  headJsonLines,
  normalizeTitle,
  fileCacheKey,
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

function datedTranscripts(root: string): FileCandidate[] {
  const out: FileCandidate[] = [];
  for (const project of childDirs(root)) {
    out.push(...datedFilesIn(project, ".jsonl"));
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

export function readClaudeRecord(entry: FileCandidate, options: ScanOptions): SessionRecord | null {
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
      // A slash command records its caveat, `<command-name>` and
      // `<local-command-stdout>` as user turns; none is a prompt the user typed.
      if (text !== null && !text.trimStart().startsWith("<")) {
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
  return datedTranscripts(root).sort((left, right) => right.mtimeMs - left.mtimeMs);
}

/**
 * What a restore-budget read found, per transcript path. `cwd` and the id sit
 * in the first lines of an append-only file, so once a head names a cwd the
 * answer cannot change as the transcript grows and the entry is final. A head
 * that named no cwd can still gain one while the file is young, so that answer
 * is only reused for the exact `mtime + size` it was read at; any growth reads
 * it again. A read that found no session is never kept: an unreadable file
 * (EMFILE, a Windows sharing violation) says nothing about its head, and a
 * remembered miss would hide that session from restore until the file grew.
 * Never holds `mtimeMs`: that comes from the current listing on every call.
 */
interface HeadIdentity {
  readonly key: string;
  readonly id: string;
  readonly cwd: string | null;
}
const identityByPath = new Map<string, HeadIdentity>();

function readIdentity(entry: FileCandidate, options: ScanOptions): SessionRecord | null {
  const key = fileCacheKey(entry);
  const hit = identityByPath.get(entry.filePath);
  if (hit !== undefined && (hit.cwd !== null || hit.key === key)) {
    return {
      id: hit.id,
      cwd: hit.cwd,
      mtimeMs: entry.mtimeMs,
      sourcePath: entry.filePath,
      title: null,
    };
  }
  const record = readClaudeRecord(entry, options);
  if (record === null) {
    identityByPath.delete(entry.filePath);
  } else {
    identityByPath.set(entry.filePath, { key, id: record.id, cwd: record.cwd });
  }
  return record;
}

/** List + cap + read. Head reads are remembered across calls (see
 *  `identityByPath`) but the listing is always fresh, so every call reflects
 *  the current state of disk. The boot path's shape; the history surface uses
 *  `listClaudeFiles` + `readClaudeRecord` so it can skip reads. */
export function scanClaude(home: string, options: ScanOptions): ScanResult {
  const newestFirst = listClaudeFiles(home);
  const window = newestFirst.slice(0, options.maxFiles);
  // A title needs the lines the identity cache does not keep; that caller
  // (session history) has its own `path + mtime + size` cache.
  const cached = !options.withTitle;
  const records: SessionRecord[] = [];
  for (const entry of window) {
    const record = cached ? readIdentity(entry, options) : readClaudeRecord(entry, options);
    if (record !== null) {
      records.push(record);
    }
  }
  if (cached) {
    // Bounded by `maxFiles`: drop whatever the current window no longer lists.
    const live = new Set(window.map((entry) => entry.filePath));
    for (const filePath of identityByPath.keys()) {
      if (!live.has(filePath)) {
        identityByPath.delete(filePath);
      }
    }
  }
  return { total: newestFirst.length, records };
}

/** The boot path's shape, unchanged: ids and cwds, no titles. */
export function candidates(home: string): CandidateSession[] {
  return scanClaude(home, CLAUDE_RESTORE_SCAN).records.slice();
}
