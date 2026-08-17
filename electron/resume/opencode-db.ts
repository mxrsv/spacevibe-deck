/**
 * `<home>/.local/share/opencode/opencode.db` → resumable opencode sessions and
 * the newest sentence each one said.
 *
 * opencode 1.18 moved its state out of the `storage/` json tree
 * (`opencode.ts`) and into SQLite, keeping the ids and the json shapes exactly
 * as they were: a `message.data` blob still carries `role`, a `part.data` blob
 * still carries `type` and `text`. So this module is a second READER of the
 * same model, not a second model — and `opencode.ts` merges the two so callers
 * never learn which install layout answered.
 *
 * `node:sqlite` is Node's own driver: no npm dependency, no native rebuild, no
 * packaging or signing consequence. It ships in the Node that Electron 43
 * embeds (24.18.1, verified on this machine).
 *
 * Every entry point is fail-soft, like the file scanners it stands beside: a
 * missing database, a schema that moved again, a locked writer or a malformed
 * row answers empty/null rather than throwing into a batch of eight panes.
 */
import { lstatSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CandidateSession } from "./head";

const OPENCODE_DB_PATH = path.join(
  ".local",
  "share",
  "opencode",
  "opencode.db",
);

/** Newest-first scan bound, matching the file scanner's `MAX_FILES`. */
const MAX_SESSIONS = 300;

/**
 * Sessions, newest first. `parent_id IS NULL` keeps sub-agent sessions out:
 * opencode spawns one per delegated task (56 of this machine's 157), they
 * share their parent's `directory`, and a rail row that quoted one would be
 * showing a sub-agent's turn as if the pane had said it.
 */
const SESSIONS_SQL = `
  SELECT id, directory, time_updated
  FROM session
  WHERE parent_id IS NULL
  ORDER BY time_updated DESC
  LIMIT ?
`;

/**
 * The newest assistant text of one session, in one statement.
 *
 * The two `json_extract` predicates are the SQL spelling of the file walk in
 * `opencode.ts`: `role = 'assistant'` skips the user's own turns, and
 * `type = 'text'` skips `reasoning` (which carries a `text` field of its own
 * and would print the model's private thinking), `step-start`, tool calls and
 * patches. A turn that only ran tools contributes no row at all, so ordering
 * by time and taking one row IS the walk-back to the turn before it.
 */
const TAIL_SQL = `
  SELECT json_extract(p.data, '$.text') AS text
  FROM part p
  JOIN message m ON m.id = p.message_id
  WHERE p.session_id = ?
    AND json_extract(p.data, '$.type') = 'text'
    AND json_extract(m.data, '$.role') = 'assistant'
  ORDER BY p.time_created DESC
  LIMIT 1
`;

/** True when the database exists as a regular file — a symlink is refused
 *  rather than followed, the same rule `headBytes` applies to transcripts. */
function isReadableDatabase(filePath: string): boolean {
  try {
    return lstatSync(filePath, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

/**
 * Open read-only, run `query`, always close. Opening is cheap — SQLite reads
 * a page, not the whole 290 MB file — and a connection that outlived the call
 * would hold a handle on a database another process is actively writing.
 */
function withDatabase<T>(
  home: string,
  query: (db: DatabaseSync) => T,
  fallback: T,
): T {
  const filePath = path.join(home, OPENCODE_DB_PATH);
  if (!isReadableDatabase(filePath)) {
    return fallback;
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
  } catch {
    return fallback;
  }
  try {
    return query(db);
  } catch {
    return fallback;
  } finally {
    try {
      db.close();
    } catch {
      /* a database that cannot be closed is already gone */
    }
  }
}

function toCandidate(row: Record<string, unknown>): CandidateSession | null {
  const id = row.id;
  if (typeof id !== "string" || id === "") {
    return null;
  }
  const directory = row.directory;
  const updated = row.time_updated;
  return {
    id,
    cwd: typeof directory === "string" && directory !== "" ? directory : null,
    mtimeMs: typeof updated === "number" ? updated : 0,
  };
}

/** Every session the database knows about, newest first. Empty when opencode
 *  is not installed, predates 1.18, or the query failed. */
export function candidates(home: string): CandidateSession[] {
  return withDatabase(
    home,
    (db) => {
      const rows = db.prepare(SESSIONS_SQL).all(MAX_SESSIONS);
      const out: CandidateSession[] = [];
      for (const row of rows) {
        const candidate = toCandidate(row as Record<string, unknown>);
        if (candidate !== null) {
          out.push(candidate);
        }
      }
      return out;
    },
    [],
  );
}

/** The newest thing this session's agent said, or null. */
export function sessionTailText(
  home: string,
  sessionId: string,
): string | null {
  return withDatabase(
    home,
    (db) => {
      const row = db.prepare(TAIL_SQL).get(sessionId) as
        Record<string, unknown> | undefined;
      const text = row?.text;
      return typeof text === "string" && text.trim() !== "" ? text : null;
    },
    null,
  );
}
