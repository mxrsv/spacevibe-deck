/**
 * Session history's data layer: the `electron/resume/` scanners run with the
 * history budget, their records folded into one newest-first list.
 *
 * Stat first, heads lazy (spec §1.4). Every candidate file is stat'ed on every
 * call — that is what makes a re-open notice a changed transcript — but a file
 * whose `path + mtime + size` is already in the enrichment map is never
 * OPENED again. Reversing that order (scan everything, then cache) would leave
 * the map decorative: the reads it was meant to save have already happened.
 *
 * Nothing here is persisted. Titles and cwds are conversation-adjacent data
 * and stay in RAM for the life of the process, matching the contract the usage
 * cache states for itself (spec §1.4, "Privacy").
 */
import { CLAUDE_RESTORE_SCAN, listClaudeFiles, readClaudeRecord } from '../resume/claude';
import { CODEX_RESTORE_SCAN, listCodexFiles, readCodexRecord } from '../resume/codex';
import { fileCacheKey, type FileCandidate, type SessionRecord } from '../resume/head';
import {
  SESSIONS_DEFAULT_LIMIT,
  SESSIONS_MAX_LIMIT,
  type SessionAgent,
  type SessionEntry,
  type SessionsSnapshot,
} from './model';

/** The history budget: the restore budget plus titles. */
const CLAUDE_HISTORY_SCAN = { ...CLAUDE_RESTORE_SCAN, withTitle: true };
const CODEX_HISTORY_SCAN = {
  ...CODEX_RESTORE_SCAN,
  withTitle: true,
  // Archived means the user put it away (spec §1.3).
  includeArchived: false,
  interactiveOnly: true,
};

/** One head read per agent, injectable so a test can count them. */
export interface SessionReaders {
  readonly claude: (file: FileCandidate) => SessionRecord | null;
  readonly codex: (file: FileCandidate) => SessionRecord | null;
}

const DEFAULT_READERS: SessionReaders = {
  claude: (file) => readClaudeRecord(file, CLAUDE_HISTORY_SCAN),
  codex: (file) => readCodexRecord(file, CODEX_HISTORY_SCAN),
};

/** `path + mtime + size` → the record read from it. A miss is the ONLY thing
 *  that opens a file. `null` is cached too: a transcript that names no session
 *  will not name one on the next open either. */
const enriched = new Map<string, SessionRecord | null>();

export function clearSessionsCache(): void {
  enriched.clear();
}

function toEntry(agent: SessionAgent, record: SessionRecord): SessionEntry | null {
  // No recorded directory means no correct place to resume, so the row is
  // dropped rather than shown and then refused (spec §1.4).
  if (record.cwd === null) {
    return null;
  }
  return {
    agent,
    sessionId: record.id,
    cwd: record.cwd,
    lastActivityMs: record.mtimeMs,
    title: record.title,
    sourcePath: record.sourcePath,
  };
}

function safeList(run: () => FileCandidate[]): FileCandidate[] {
  try {
    return run();
  } catch {
    // A missing or unreadable state directory is a normal answer, not a
    // failure: the surface says "nothing found", it does not say "broken".
    return [];
  }
}

/**
 * Files read between breaths.
 *
 * The same figure `electron/usage/scan.ts` uses, for the same reason: the main
 * process owns every PTY, so a long synchronous run here stops output reaching
 * panes and keystrokes reaching agents. A history scan reads up to
 * `SESSIONS_MAX_LIMIT` heads per agent at 64 KiB each — tens of megabytes of
 * blocking I/O in one go before this yielded at all.
 */
const READ_BATCH_FILES = 8;

/** Hand the event loop back, so PTY and window IPC are not starved. */
function breathe(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function collect(
  agent: SessionAgent,
  files: readonly FileCandidate[],
  limit: number,
  read: (file: FileCandidate) => SessionRecord | null,
  into: SessionEntry[],
): Promise<void> {
  let sinceBreath = 0;
  for (const file of files.slice(0, limit)) {
    sinceBreath += 1;
    if (sinceBreath >= READ_BATCH_FILES) {
      sinceBreath = 0;
      await breathe();
    }
    const key = fileCacheKey(file);
    let record: SessionRecord | null;
    if (enriched.has(key)) {
      record = enriched.get(key) ?? null;
    } else {
      record = read(file);
      enriched.set(key, record);
    }
    if (record === null) {
      continue;
    }
    const entry = toEntry(agent, record);
    if (entry !== null) {
      into.push(entry);
    }
  }
}

/**
 * Async because it runs on the MAIN process, which owns every PTY.
 *
 * The two directory walks are still synchronous — they are stat-only and the
 * scanners they live in are shared with the boot restore path — but the head
 * reads, which are the expensive half, now yield every `READ_BATCH_FILES`
 * files, and the walks are separated by a breath. Before this, opening the
 * history tab (or the boot probe, whose `limit: 1` caps reads but NOT the
 * walk) blocked the loop for the whole scan: no `pty:output` delivered, no
 * keystroke forwarded, every window frozen.
 */
export async function listSessions(
  home: string,
  limit: number = SESSIONS_DEFAULT_LIMIT,
  readers: SessionReaders = DEFAULT_READERS,
): Promise<SessionsSnapshot> {
  const capped = Math.max(1, Math.min(Math.floor(limit), SESSIONS_MAX_LIMIT));
  const claudeFiles = safeList(() => listClaudeFiles(home));
  await breathe();
  const codexFiles = safeList(() => listCodexFiles(home, CODEX_HISTORY_SCAN.includeArchived));
  await breathe();

  const entries: SessionEntry[] = [];
  await collect('claude', claudeFiles, capped, readers.claude, entries);
  await collect('codex', codexFiles, capped, readers.codex, entries);
  entries.sort((left, right) => right.lastActivityMs - left.lastActivityMs);

  return {
    entries,
    // Pre-cap FILE counts — what "showing latest N of M" reads.
    totals: { claude: claudeFiles.length, codex: codexFiles.length },
    limit: capped,
  };
}
