import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSessionsCache, listSessions } from "./list";
import { CLAUDE_RESTORE_SCAN, readClaudeRecord } from "../resume/claude";
import type { FileCandidate } from "../resume/head";
import { CLAUDE_DIR, CLAUDE_PROJECTS_DIR, TRANSCRIPT_EXTENSION } from "../usage/model";

const T0 = Date.parse("2026-08-01T00:00:00Z");

function claudeSession(
  home: string,
  id: string,
  cwd: string | null,
  title: string,
  mtimeMs: number,
): void {
  const project = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, `-p-${id}`);
  mkdirSync(project, { recursive: true });
  const file = path.join(project, `${id}${TRANSCRIPT_EXTENSION}`);
  const lines = [JSON.stringify({ type: "last-prompt", sessionId: id })];
  if (cwd !== null) {
    lines.push(JSON.stringify({ type: "system", sessionId: id, cwd }));
  }
  lines.push(JSON.stringify({ type: "user", message: { role: "user", content: title } }));
  writeFileSync(file, lines.join("\n"));
  utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

describe("listSessions", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-list-"));
    clearSessionsCache();
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("sorts newest first across agents", async () => {
    claudeSession(home, "older", "/a", "first", T0);
    claudeSession(home, "newer", "/b", "second", T0 + 60_000);
    const snapshot = await listSessions(home);
    expect(snapshot.entries.map((e) => e.sessionId)).toEqual(["newer", "older"]);
  });

  it("drops a session whose transcript names no cwd", async () => {
    claudeSession(home, "nocwd", null, "orphan", T0);
    expect((await listSessions(home)).entries).toHaveLength(0);
  });

  it("carries the title and the agent id", async () => {
    claudeSession(home, "sid", "/work", "make it green", T0);
    const [entry] = (await listSessions(home)).entries;
    expect(entry.agent).toBe("claude");
    expect(entry.title).toBe("make it green");
    expect(entry.cwd).toBe("/work");
  });

  it("caps entries per agent and reports the pre-cap total", async () => {
    for (let i = 0; i < 4; i += 1) {
      claudeSession(home, `s${i}`, "/work", `t${i}`, T0 + i * 1000);
    }
    const snapshot = await listSessions(home, 2);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.totals.claude).toBe(4);
    expect(snapshot.limit).toBe(2);
  });

  it("re-reads a file whose mtime changed", async () => {
    claudeSession(home, "sid", "/work", "first title", T0);
    expect((await listSessions(home)).entries[0].title).toBe("first title");
    claudeSession(home, "sid", "/work", "second title", T0 + 60_000);
    expect((await listSessions(home)).entries[0].title).toBe("second title");
  });

  // The assertion that makes the cache real. A cache applied AFTER the scan
  // would pass the mtime test above and still read every head twice — this
  // one counts the reads, so it can only pass if the key is checked BEFORE
  // the file is opened (spec §1.4 step 3).
  it("opens no file on a second scan when nothing changed", async () => {
    claudeSession(home, "a", "/work", "one", T0);
    claudeSession(home, "b", "/work", "two", T0 + 1000);
    let reads = 0;
    const readers = {
      claude: (file: FileCandidate) => {
        reads += 1;
        return readClaudeRecord(file, {
          ...CLAUDE_RESTORE_SCAN,
          withTitle: true,
        });
      },
      codex: () => null,
    };
    await listSessions(home, 500, readers);
    expect(reads).toBe(2);
    await listSessions(home, 500, readers);
    expect(reads).toBe(2);
  });

  it("answers an empty snapshot when no state directory exists", async () => {
    const snapshot = await listSessions(path.join(home, "nowhere"));
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.totals.claude).toBe(0);
    expect(snapshot.totals.codex).toBe(0);
  });
});
