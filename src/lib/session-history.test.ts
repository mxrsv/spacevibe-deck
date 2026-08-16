import { describe, expect, it } from "vitest";
import { asSessionsSnapshot, SESSIONS_DEFAULT_LIMIT } from "./session-history";

/**
 * The renderer's validation boundary for `sessions_list` replies (C7/C8). The
 * main process is the only producer today, but the reply arrives as `unknown`
 * over IPC and this is the one place it is narrowed, so the narrowing is
 * tested on its own rather than only through the facade.
 */

function reply(entries: readonly unknown[]): unknown {
  return { entries, totals: { claude: 1, codex: 0 }, limit: 500 };
}

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent: "claude",
    sessionId: "sid",
    cwd: "/work/repo",
    lastActivityMs: 1,
    title: "t",
    sourcePath: "/p",
    ...over,
  };
}

describe("asSessionsSnapshot", () => {
  it("keeps a well-formed entry", () => {
    const snapshot = asSessionsSnapshot(reply([entry()]));
    expect(snapshot?.entries).toHaveLength(1);
    expect(snapshot?.entries[0].sessionId).toBe("sid");
  });

  it("answers null when the reply is not a snapshot", () => {
    expect(asSessionsSnapshot({ nope: true })).toBeNull();
    expect(asSessionsSnapshot(null)).toBeNull();
  });

  // An id that cannot resume must not become a row. `"claude".includes("")` is
  // true for every string, so a containment check downstream cannot catch this.
  it("drops an entry whose session id is empty", () => {
    expect(
      asSessionsSnapshot(reply([entry({ sessionId: "" })]))?.entries,
    ).toEqual([]);
  });

  // An empty cwd would spawn the resumed pane in $HOME — the exact silent
  // wrong-directory behaviour spec §4 refuses for this path.
  it("drops an entry whose cwd is empty", () => {
    expect(asSessionsSnapshot(reply([entry({ cwd: "" })]))?.entries).toEqual(
      [],
    );
  });

  it("drops a malformed entry without dropping its neighbours", () => {
    const snapshot = asSessionsSnapshot(
      reply([entry({ agent: "gemini" }), entry({ sessionId: "kept" })]),
    );
    expect(snapshot?.entries.map((item) => item.sessionId)).toEqual(["kept"]);
  });

  it("treats a missing title as no title rather than dropping the entry", () => {
    const snapshot = asSessionsSnapshot(reply([entry({ title: 42 })]));
    expect(snapshot?.entries[0].title).toBeNull();
  });

  it("falls back to the default limit when the reply names none", () => {
    const snapshot = asSessionsSnapshot({
      entries: [],
      totals: {},
      limit: "500",
    });
    expect(snapshot?.limit).toBe(SESSIONS_DEFAULT_LIMIT);
    expect(snapshot?.totals.claude).toBe(0);
  });
});
