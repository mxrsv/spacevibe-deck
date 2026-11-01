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

const OPENCODE_DB_PATH = path.join(".local", "share", "opencode", "opencode.db");

/** Newest-first scan bound, matching the file scanner's `MAX_FILES`. */
const MAX_SESSIONS = 300;

/**
 * `parent_id IS NULL` keeps sub-agent sessions out: opencode spawns one per
 * delegated task (56 of this machine's 157), they share their parent's
 * `directory`, and a rail row that quoted one would be showing a sub-agent's
 * turn as if the pane had said it.
 */
const V1_SESSIONS_SQL = "SELECT id, directory, time_updated FROM session WHERE parent_id IS NULL";
const V2_SESSIONS_SQL =
  "SELECT id, directory, time_updated FROM session_v2 WHERE parent_id IS NULL";

/** Sessions newest first; a session both generations hold counts once, at its newest. */
function sessionsSql(sources: readonly string[]): string {
  return `
    SELECT id, directory, MAX(time_updated) AS time_updated
    FROM (${sources.join(" UNION ALL ")})
    GROUP BY id
    ORDER BY time_updated DESC
    LIMIT ?
  `;
}

/**
 * The newest assistant text of one session, and the model that message ran
 * on, in one statement.
 *
 * The two `json_extract` predicates are the SQL spelling of the file walk in
 * `opencode.ts`: `role = 'assistant'` skips the user's own turns, and
 * `type = 'text'` skips `reasoning` (which carries a `text` field of its own
 * and would print the model's private thinking), `step-start`, tool calls and
 * patches. A turn that only ran tools contributes no row at all, so ordering
 * by time and taking one row IS the walk-back to the turn before it.
 *
 * `modelID` sits on the MESSAGE, not the part, but comes along for free in
 * the same join. This is the newest **text-bearing** turn only: a turn that
 * switched model and then only ran tools reports the previous model until it
 * speaks again.
 */
const V1_TAIL_SQL = `
  SELECT json_extract(p.data, '$.text') AS text, json_extract(m.data, '$.modelID') AS model,
    p.time_created AS at, 0 AS item
  FROM part p
  JOIN message m ON m.id = p.message_id
  WHERE p.session_id = ?
    AND json_extract(p.data, '$.type') = 'text'
    AND json_extract(m.data, '$.role') = 'assistant'
`;

/**
 * The 2.x spelling of the same rule: an assistant row of `session_message`
 * holds its parts in a `content` array (`text`, `reasoning`, `tool`) and its
 * model under `model.id`. The last text item of the newest message wins.
 */
const V2_TAIL_SQL = `
  SELECT json_extract(c.value, '$.text') AS text, json_extract(sm.data, '$.model.id') AS model,
    sm.time_created AS at, c.key AS item
  FROM session_message sm, json_each(sm.data, '$.content') c
  WHERE sm.session_id = ?
    AND sm.type = 'assistant'
    AND json_extract(c.value, '$.type') = 'text'
`;

function tailSql(sources: readonly string[]): string {
  return `SELECT text, model FROM (${sources.join(" UNION ALL ")}) ORDER BY at DESC, item DESC LIMIT 1`;
}

function hasTables(db: DatabaseSync, names: readonly string[]): boolean {
  const lookup = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  return names.every((name) => lookup.get(name) !== undefined);
}

/**
 * One opencode generation's statement and the tables it needs.
 *
 * opencode 2.0 copied every 1.x session into `session_v2` and its turns into
 * `session_message`, then writes new ones there only. Reading the 1.x tables
 * alone missed every 2.x session, so restore resumed an older 1.x session
 * from the same directory instead (measured 2026-10-24, opencode 2.0.32).
 * Each generation is read only when its tables exist, so either install
 * answers.
 */
interface Source {
  readonly tables: readonly string[];
  readonly sql: string;
}

const SESSION_SOURCES: readonly Source[] = [
  { tables: ["session"], sql: V1_SESSIONS_SQL },
  { tables: ["session_v2"], sql: V2_SESSIONS_SQL },
];

const TAIL_SOURCES: readonly Source[] = [
  { tables: ["message", "part"], sql: V1_TAIL_SQL },
  { tables: ["session_message"], sql: V2_TAIL_SQL },
];

/** The statements of the generations this database holds; empty when neither. */
function presentSources(db: DatabaseSync, sources: readonly Source[]): string[] {
  return sources.filter((source) => hasTables(db, source.tables)).map((source) => source.sql);
}

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
function withDatabase<T>(home: string, query: (db: DatabaseSync) => T, fallback: T): T {
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
      const sources = presentSources(db, SESSION_SOURCES);
      if (sources.length === 0) {
        return [];
      }
      const rows = db.prepare(sessionsSql(sources)).all(MAX_SESSIONS);
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

/**
 * `TAIL_SQL`'s one row, both columns pulled and validated the same way
 * `sessionTailText` and `sessionModel` each need — one shared shape so the
 * two never validate the same columns differently. Each caller of either
 * function still runs the statement once (the row is not cached across
 * calls, matching every other reader in this module), which is why
 * `session-tail.ts` asking for both a session's text and its model costs two
 * cheap reads rather than one.
 */
interface TailRow {
  readonly text: string | null;
  readonly model: string | null;
}

function queryTail(home: string, sessionId: string): TailRow {
  return withDatabase(
    home,
    (db) => {
      const sources = presentSources(db, TAIL_SOURCES);
      if (sources.length === 0) {
        return { text: null, model: null };
      }
      const row = db.prepare(tailSql(sources)).get(...sources.map(() => sessionId)) as
        Record<string, unknown> | undefined;
      const text = row?.text;
      const model = row?.model;
      return {
        text: typeof text === "string" && text.trim() !== "" ? text : null,
        model: typeof model === "string" && model !== "" ? model : null,
      };
    },
    { text: null, model: null },
  );
}

/** The newest thing this session's agent said, or null. */
export function sessionTailText(home: string, sessionId: string): string | null {
  return queryTail(home, sessionId).text;
}

/** The model that newest text-bearing turn ran on, or null. */
export function sessionModel(home: string, sessionId: string): string | null {
  return queryTail(home, sessionId).model;
}
