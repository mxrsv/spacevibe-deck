/**
 * `~/.codex` rollouts → resumable Codex sessions.
 *
 * Reuses `discoverCodex` for the file walk rather than re-implementing the
 * `sessions`/`archived_sessions`, depth-bounded, symlink-refusing traversal
 * `electron/usage/discover.ts` already owns.
 */
import { statSync } from "node:fs";
import { discoverCodex } from "../usage/discover";
import { IDENTITY_HEAD_BYTES } from "../usage/model";
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

/** Extra knobs only Codex has: two directories and two kinds of non-human run. */
export interface CodexScanOptions extends ScanOptions {
  readonly includeArchived: boolean;
  readonly interactiveOnly: boolean;
}

/**
 * 64 KiB, NOT the 8 KiB this file shipped with. Measured 2026-08-16 against
 * the real corpus: `session_meta` embeds `base_instructions`, so the head line
 * alone is ~18.6 KB and an 8 KiB window parsed 0 of 300 rollouts — every Codex
 * pane restored as a fresh conversation. 32 KiB parsed 300/300; 64 KiB is the
 * same `IDENTITY_HEAD_BYTES` the rest of the codebase reads with, and also
 * reaches the first user turn in 48 of 52 interactive rollouts (p50 20 KiB,
 * p90 38 KiB, max 107 KiB).
 *
 * `interactiveOnly` is ON for the boot path too: resuming a pane INTO an
 * `exec` run or a subagent thread would be wrong, not merely noisy.
 */
export const CODEX_RESTORE_SCAN: CodexScanOptions = Object.freeze({
  maxFiles: 300,
  headBytes: IDENTITY_HEAD_BYTES,
  headLines: 60,
  withTitle: false,
  includeArchived: true,
  interactiveOnly: true,
});

/**
 * Names what to REJECT, not what to accept. `source` is a plain string for a
 * human-driven run (`"cli"`, `"vscode"`), the literal `"exec"` for the
 * non-interactive CLI, and an OBJECT for a spawned one (`{ subagent: … }`).
 * Measured share of the newest 300 rollouts on this machine, 2026-08-16:
 * vscode 168, subagent 77, cli 38, exec 15.
 *
 * An ABSENT `source` is kept: older rollouts predate the field (that is the
 * shape `resolve.test.ts`'s own fixture writes), and a filter phrased as
 * "must carry a known-good marker" would delete them from restore.
 */
function isNonInteractiveSource(source: unknown): boolean {
  if (source === "exec") {
    return true;
  }
  return source !== null && typeof source === "object";
}

/** Injected context blocks open with a tag; a person's first line does not. */
function codexUserText(payload: Record<string, unknown>): string | null {
  if (payload.type === "user_message" && typeof payload.message === "string") {
    return payload.message;
  }
  if (payload.type !== "message" || payload.role !== "user") {
    return null;
  }
  const content = payload.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  for (const part of content) {
    if (part !== null && typeof part === "object") {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") {
        return text;
      }
    }
  }
  return null;
}

/** Every rollout, newest first, stat only — no file is opened here. */
export function listCodexFiles(home: string, includeArchived: boolean): FileCandidate[] {
  const discovery = discoverCodex(home);
  const files = includeArchived ? [...discovery.active, ...discovery.archived] : discovery.active;
  const out: FileCandidate[] = [];
  for (const filePath of files) {
    try {
      const info = statSync(filePath);
      out.push({ filePath, mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      continue;
    }
  }
  return out.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

export function readCodexRecord(
  entry: FileCandidate,
  options: CodexScanOptions,
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
  const payload = (first as Record<string, unknown>).payload;
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const meta = payload as Record<string, unknown>;
  if (options.interactiveOnly && isNonInteractiveSource(meta.source)) {
    return null;
  }
  const id = meta.id;
  if (typeof id !== "string" || id === "") {
    return null;
  }
  const cwd = typeof meta.cwd === "string" && meta.cwd !== "" ? meta.cwd : null;
  let title: string | null = null;
  if (options.withTitle) {
    for (const line of lines.slice(1)) {
      if (line === null || typeof line !== "object") {
        continue;
      }
      const body = (line as Record<string, unknown>).payload;
      if (body === null || typeof body !== "object") {
        continue;
      }
      const text = codexUserText(body as Record<string, unknown>);
      if (text === null || text.trimStart().startsWith("<")) {
        continue;
      }
      title = normalizeTitle(text);
      if (title !== null) {
        break;
      }
    }
  }
  return { id, cwd, mtimeMs: entry.mtimeMs, sourcePath: entry.filePath, title };
}

export function scanCodex(home: string, options: CodexScanOptions): ScanResult {
  const newestFirst = listCodexFiles(home, options.includeArchived);
  const records: SessionRecord[] = [];
  for (const entry of newestFirst.slice(0, options.maxFiles)) {
    const record = readCodexRecord(entry, options);
    if (record !== null) {
      records.push(record);
    }
  }
  return { total: newestFirst.length, records };
}

export function candidates(home: string): CandidateSession[] {
  return scanCodex(home, CODEX_RESTORE_SCAN).records.slice();
}
