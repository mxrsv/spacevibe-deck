/**
 * The SQLite half of opencode's state (1.18 and up), and the merge that hides
 * which half answered.
 *
 * The fixtures build a real database with the columns the reader actually
 * queries, because the whole defect this module exists for was a reader
 * pointed at a store that had stopped being written — a hand-stubbed row shape
 * would not have caught it either.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as opencode from "./opencode";
import { candidates, sessionTailText } from "./opencode-db";

const T0 = Date.parse("2026-08-17T10:00:00Z");

let home: string;

function databasePath(root: string): string {
  return path.join(root, ".local", "share", "opencode", "opencode.db");
}

/** The three tables and the two columns-of-json the reader depends on. */
function createDatabase(root: string): DatabaseSync {
  const filePath = databasePath(root);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      parent_id text,
      directory text NOT NULL,
      time_updated integer NOT NULL
    );
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      data text NOT NULL
    );
  `);
  return db;
}

function addSession(
  db: DatabaseSync,
  id: string,
  directory: string,
  timeUpdated: number,
  parentId: string | null = null,
): void {
  db.prepare(
    "INSERT INTO session (id, project_id, parent_id, directory, time_updated) VALUES (?, ?, ?, ?, ?)",
  ).run(id, "prj_1", parentId, directory, timeUpdated);
}

function addMessage(
  db: DatabaseSync,
  sessionId: string,
  id: string,
  role: string,
  timeCreated: number,
): void {
  db.prepare(
    "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
  ).run(id, sessionId, timeCreated, JSON.stringify({ role, agent: "build" }));
}

function addPart(
  db: DatabaseSync,
  sessionId: string,
  messageId: string,
  id: string,
  data: Record<string, unknown>,
  timeCreated: number,
): void {
  db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
  ).run(id, messageId, sessionId, timeCreated, JSON.stringify(data));
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "opencode-db-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("opencode-db.candidates", () => {
  it("reports sessions newest first, with directory as the cwd", () => {
    const db = createDatabase(home);
    addSession(db, "ses_old", "/tmp/one", T0);
    addSession(db, "ses_new", "/tmp/two", T0 + 5000);
    db.close();

    expect(candidates(home)).toEqual([
      { id: "ses_new", cwd: "/tmp/two", mtimeMs: T0 + 5000 },
      { id: "ses_old", cwd: "/tmp/one", mtimeMs: T0 },
    ]);
  });

  it("leaves sub-agent sessions out", () => {
    // A delegated task gets its own session under the same directory. Quoting
    // one on the rail would show a sub-agent's turn as the pane's own.
    const db = createDatabase(home);
    addSession(db, "ses_parent", "/tmp/one", T0);
    addSession(db, "ses_child", "/tmp/one", T0 + 9000, "ses_parent");
    db.close();

    expect(candidates(home).map((entry) => entry.id)).toEqual(["ses_parent"]);
  });

  it("answers empty when no database exists, without throwing", () => {
    expect(() => candidates(home)).not.toThrow();
    expect(candidates(home)).toEqual([]);
  });
});

describe("opencode-db.sessionTailText", () => {
  it("takes the newest assistant text, skipping reasoning and the user", () => {
    const db = createDatabase(home);
    addSession(db, "ses_a", "/tmp/one", T0);
    addMessage(db, "ses_a", "msg_said", "assistant", T0);
    addPart(
      db,
      "ses_a",
      "msg_said",
      "prt_step",
      { type: "step-start" },
      T0 + 10,
    );
    addPart(
      db,
      "ses_a",
      "msg_said",
      "prt_text",
      { type: "text", text: "Working tree clean." },
      T0 + 20,
    );
    // Newer than the sentence, and it carries a `text` field of its own.
    addPart(
      db,
      "ses_a",
      "msg_said",
      "prt_reason",
      { type: "reasoning", text: "PRIVATE: the diff looked empty." },
      T0 + 30,
    );
    // Newest turn of all, but it is the user's.
    addMessage(db, "ses_a", "msg_ask", "user", T0 + 40);
    addPart(
      db,
      "ses_a",
      "msg_ask",
      "prt_ask",
      { type: "text", text: "and now?" },
      T0 + 40,
    );
    db.close();

    expect(sessionTailText(home, "ses_a")).toBe("Working tree clean.");
  });

  it("falls back to the turn before one that only ran tools", () => {
    const db = createDatabase(home);
    addSession(db, "ses_b", "/tmp/one", T0);
    addMessage(db, "ses_b", "msg_old", "assistant", T0);
    addPart(
      db,
      "ses_b",
      "msg_old",
      "prt_old",
      { type: "text", text: "Ran the migration." },
      T0,
    );
    addMessage(db, "ses_b", "msg_tool", "assistant", T0 + 50);
    addPart(
      db,
      "ses_b",
      "msg_tool",
      "prt_tool",
      { type: "tool", tool: "bash" },
      T0 + 50,
    );
    db.close();

    expect(sessionTailText(home, "ses_b")).toBe("Ran the migration.");
  });

  it("never crosses sessions and answers null when a session said nothing", () => {
    const db = createDatabase(home);
    addSession(db, "ses_quiet", "/tmp/one", T0);
    addSession(db, "ses_loud", "/tmp/two", T0);
    addMessage(db, "ses_loud", "msg_loud", "assistant", T0);
    addPart(
      db,
      "ses_loud",
      "msg_loud",
      "prt_loud",
      { type: "text", text: "Someone else's sentence." },
      T0,
    );
    addMessage(db, "ses_quiet", "msg_quiet", "assistant", T0 + 10);
    db.close();

    expect(sessionTailText(home, "ses_quiet")).toBeNull();
  });

  it("answers null for an unknown session and with no database at all", () => {
    expect(sessionTailText(home, "ses_missing")).toBeNull();
    const db = createDatabase(home);
    addSession(db, "ses_a", "/tmp/one", T0);
    db.close();
    expect(sessionTailText(home, "ses_missing")).toBeNull();
  });
});

describe("opencode.candidates merge", () => {
  /** One pre-1.18 session object, in the layout the file scanner walks. */
  function writeLegacySession(id: string, directory: string, updated: number) {
    const bucket = path.join(
      home,
      ".local",
      "share",
      "opencode",
      "storage",
      "session",
      "bucket1",
    );
    mkdirSync(bucket, { recursive: true });
    writeFileSync(
      path.join(bucket, `${id}.json`),
      JSON.stringify({ id, directory, time: { updated } }),
    );
  }

  it("keeps a migrated session ONCE, in its database form", () => {
    // The migration carried ids over unchanged. Two copies of one session
    // would defeat `resolve.ts`'s greedy dedup: a second pane would "match"
    // the file copy of the session the first pane already took.
    const db = createDatabase(home);
    addSession(db, "ses_both", "/tmp/one", T0 + 7000);
    db.close();
    writeLegacySession("ses_both", "/tmp/one", T0);

    const found = opencode.candidates(home);
    expect(found).toHaveLength(1);
    expect(found[0].mtimeMs).toBe(T0 + 7000);
  });

  it("still reports a session that only the json tree has", () => {
    const db = createDatabase(home);
    addSession(db, "ses_db", "/tmp/one", T0);
    db.close();
    writeLegacySession("ses_file_only", "/tmp/two", T0);

    expect(
      opencode
        .candidates(home)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["ses_db", "ses_file_only"]);
  });

  it("reads the json tree alone when no database exists", () => {
    writeLegacySession("ses_file_only", "/tmp/two", T0);
    expect(opencode.candidates(home).map((entry) => entry.id)).toEqual([
      "ses_file_only",
    ]);
  });
});
