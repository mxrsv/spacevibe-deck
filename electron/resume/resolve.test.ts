import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveResume, validateResumeRequests } from "./resolve";
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  CODEX_DIR,
  CODEX_ROLLOUT_PREFIX,
  CODEX_SESSIONS_DIR,
  TRANSCRIPT_EXTENSION,
} from "../usage/model";

const T0 = Date.parse("2026-08-01T00:00:00Z");
const T1 = T0;
const T2 = T0 + 120_000;

function writeAt(filePath: string, contents: string, mtimeMs: number): void {
  writeFileSync(filePath, contents);
  const seconds = mtimeMs / 1000;
  utimesSync(filePath, seconds, seconds);
}

function writeBufferAt(filePath: string, contents: Buffer, mtimeMs: number): void {
  writeFileSync(filePath, contents);
  const seconds = mtimeMs / 1000;
  utimesSync(filePath, seconds, seconds);
}

describe("resolveResume", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "resume-resolve-"));

    // --- claude: one matched session, plus two same-cwd sessions for dedup.
    const claudeProject = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, "-tmp-w");
    mkdirSync(claudeProject, { recursive: true });
    writeAt(
      path.join(claudeProject, "aaaa.jsonl"),
      [
        '{"sessionId":"aaaa","type":"mode"}',
        '{"sessionId":"aaaa","cwd":"/tmp/w","type":"attachment"}',
      ].join("\n"),
      T1,
    );

    const dedupProject = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, "-tmp-two");
    mkdirSync(dedupProject, { recursive: true });
    writeAt(
      path.join(dedupProject, "s1.jsonl"),
      [
        '{"sessionId":"s1","type":"mode"}',
        '{"sessionId":"s1","cwd":"/tmp/two","type":"attachment"}',
      ].join("\n"),
      T1,
    );
    writeAt(
      path.join(dedupProject, "s2.jsonl"),
      [
        '{"sessionId":"s2","type":"mode"}',
        '{"sessionId":"s2","cwd":"/tmp/two","type":"attachment"}',
      ].join("\n"),
      T2,
    );

    // --- codex: one session_meta head line.
    const codexSessions = path.join(home, CODEX_DIR, CODEX_SESSIONS_DIR);
    mkdirSync(codexSessions, { recursive: true });
    writeAt(
      path.join(codexSessions, `${CODEX_ROLLOUT_PREFIX}test${TRANSCRIPT_EXTENSION}`),
      JSON.stringify({
        type: "session_meta",
        payload: { id: "cx1", cwd: "/tmp/codex" },
      }),
      T1,
    );

    // --- opencode: one session object; time.updated must win over fs mtime.
    const opencodeBucket = path.join(
      home,
      ".local",
      "share",
      "opencode",
      "storage",
      "session",
      "bucket1",
    );
    mkdirSync(opencodeBucket, { recursive: true });
    writeAt(
      path.join(opencodeBucket, "oc1.json"),
      JSON.stringify({
        id: "oc1",
        directory: "/tmp/oc",
        time: { updated: T2 },
      }),
      // fs mtime deliberately far off from T2 — the match below only works
      // if `time.updated` is actually what gets used for ranking.
      T0 - 10_000_000,
    );

    // --- agy: cwd matching is raw-byte containment against the head window
    // (`headHaystack`), not exact-string equality against one extracted
    // run — the real `.pb` protobuf has no documented schema to anchor a
    // single clean `cwd` extraction on, so a first-run extraction routinely
    // over-captures past the cwd's real end, or starts on an unrelated
    // printable run (a URL) that happens to come first in the file.
    const agyConversations = path.join(home, ".gemini", "antigravity", "conversations");
    mkdirSync(agyConversations, { recursive: true });

    // One matched conversation: the cwd sits between control-byte
    // separators, the shape a real protobuf write plausibly produces.
    writeBufferAt(
      path.join(agyConversations, "b2f42f0b-1111-4444-8888-abcdef123456.pb"),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(" /tmp/agy-cwd "), Buffer.from([9, 9])]),
      T1,
    );

    // One with no printable path-shaped bytes at all, and stale (outside
    // the 30-day-before-lastSeenAt window) — an all-control-byte haystack
    // never contains any real cwd, so staleness is redundant for matching,
    // but it still proves a stale candidate is excluded before matching
    // even runs.
    const staleMs = T1 - 40 * 24 * 60 * 60 * 1000;
    writeBufferAt(
      path.join(agyConversations, "c3f42f0b-2222-4444-8888-abcdef654321.pb"),
      Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      staleMs,
    );

    // One whose head contains the request cwd immediately followed by more
    // printable bytes with no clean terminator — a first-run extraction
    // would capture the whole longer run and never string-equal the
    // request's cwd; containment still finds it.
    writeBufferAt(
      path.join(agyConversations, "d4f42f0b-3333-4444-8888-abcdef111111.pb"),
      Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from("/tmp/agy-morecontinued-no-gap"),
        Buffer.from([9]),
      ]),
      T1,
    );

    // One whose head contains a URL before the cwd — a first-run
    // extraction would grab the URL fragment instead; containment finds
    // the cwd regardless of what comes first.
    writeBufferAt(
      path.join(agyConversations, "e5f42f0b-4444-4444-8888-abcdef222222.pb"),
      Buffer.concat([
        Buffer.from([0, 1]),
        Buffer.from("https://example.com/foo/bar"),
        Buffer.from([9]),
        Buffer.from(" /tmp/agy-url-cwd "),
        Buffer.from([9, 9]),
      ]),
      T1,
    );

    // A containing candidate far in time, and a non-containing candidate
    // close in time — proves containment gates eligibility before recency
    // ranks it. Reused with a null-cwd request to prove time-only ranking
    // still works when there is no cwd to compare.
    writeBufferAt(
      path.join(agyConversations, "f6f42f0b-5555-4444-8888-abcdef333333.pb"),
      Buffer.concat([Buffer.from([0, 1]), Buffer.from(" /tmp/agy-priority "), Buffer.from([9])]),
      T1,
    );
    writeBufferAt(
      path.join(agyConversations, "a7f42f0b-6666-4444-8888-abcdef444444.pb"),
      Buffer.concat([Buffer.from([0, 1]), Buffer.from(" /tmp/agy-nomatch "), Buffer.from([9])]),
      T2,
    );
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("(a) matches a claude session by cwd and recency", () => {
    const [answer] = resolveResume(home, [{ agent: "claude", cwd: "/tmp/w", lastSeenAt: T1 }]);
    expect(answer).toEqual({ kind: "id", id: "aaaa" });
  });

  it("(b) two same-cwd claude requests get distinct ids", () => {
    const [first, second] = resolveResume(home, [
      { agent: "claude", cwd: "/tmp/two", lastSeenAt: T2 },
      { agent: "claude", cwd: "/tmp/two", lastSeenAt: T2 },
    ]);
    expect(first).toEqual({ kind: "id", id: "s2" });
    expect(second).toEqual({ kind: "id", id: "s1" });
  });

  it("(c) parses a codex session_meta head line", () => {
    const [answer] = resolveResume(home, [{ agent: "codex", cwd: "/tmp/codex", lastSeenAt: T1 }]);
    expect(answer).toEqual({ kind: "id", id: "cx1" });
  });

  it("(d) matches an opencode session by .directory, ranked by .time.updated", () => {
    const [answer] = resolveResume(home, [{ agent: "opencode", cwd: "/tmp/oc", lastSeenAt: T2 }]);
    expect(answer).toEqual({ kind: "id", id: "oc1" });
  });

  it("(e) gemini always answers latest, without scanning anything", () => {
    const [answer] = resolveResume(home, [{ agent: "gemini", cwd: "/anything", lastSeenAt: T1 }]);
    expect(answer).toEqual({ kind: "latest" });
  });

  it("(f) agy matches filename id from cwd bytes, falls back to latest otherwise", () => {
    const [matched, unmatched] = resolveResume(home, [
      { agent: "agy", cwd: "/tmp/agy-cwd", lastSeenAt: T1 },
      { agent: "agy", cwd: "/no/such/path", lastSeenAt: T1 },
    ]);
    expect(matched).toEqual({
      kind: "id",
      id: "b2f42f0b-1111-4444-8888-abcdef123456",
    });
    expect(unmatched).toEqual({ kind: "latest" });
  });

  it("(f2) agy matches by containment when the run has no clean terminator", () => {
    const [answer] = resolveResume(home, [{ agent: "agy", cwd: "/tmp/agy-more", lastSeenAt: T1 }]);
    expect(answer).toEqual({
      kind: "id",
      id: "d4f42f0b-3333-4444-8888-abcdef111111",
    });
  });

  it("(f3) agy matches past a URL that appears earlier in the head", () => {
    const [answer] = resolveResume(home, [
      { agent: "agy", cwd: "/tmp/agy-url-cwd", lastSeenAt: T1 },
    ]);
    expect(answer).toEqual({
      kind: "id",
      id: "e5f42f0b-4444-4444-8888-abcdef222222",
    });
  });

  it("(f4) agy prefers a containing candidate over a closer non-containing one", () => {
    const [answer] = resolveResume(home, [
      { agent: "agy", cwd: "/tmp/agy-priority", lastSeenAt: T2 },
    ]);
    expect(answer).toEqual({
      kind: "id",
      id: "f6f42f0b-5555-4444-8888-abcdef333333",
    });
  });

  it("(f5) agy falls back to time-only ranking when the request cwd is null", () => {
    const [answer] = resolveResume(home, [{ agent: "agy", cwd: null, lastSeenAt: T2 }]);
    expect(answer).toEqual({
      kind: "id",
      id: "a7f42f0b-6666-4444-8888-abcdef444444",
    });
  });

  it("(g) an unknown agent answers null", () => {
    const [answer] = resolveResume(home, [{ agent: "some-future-cli", cwd: null, lastSeenAt: T1 }]);
    expect(answer).toBeNull();
  });

  it("(h) missing/unreadable state dirs answer null without throwing", () => {
    const emptyHome = mkdtempSync(path.join(tmpdir(), "resume-empty-"));
    try {
      expect(() =>
        resolveResume(emptyHome, [
          { agent: "claude", cwd: "/tmp/w", lastSeenAt: T1 },
          { agent: "codex", cwd: "/tmp/codex", lastSeenAt: T1 },
          { agent: "opencode", cwd: "/tmp/oc", lastSeenAt: T1 },
        ]),
      ).not.toThrow();
      const answers = resolveResume(emptyHome, [
        { agent: "claude", cwd: "/tmp/w", lastSeenAt: T1 },
        { agent: "codex", cwd: "/tmp/codex", lastSeenAt: T1 },
        { agent: "opencode", cwd: "/tmp/oc", lastSeenAt: T1 },
      ]);
      expect(answers).toEqual([null, null, null]);
    } finally {
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it("(i) a malformed request answers null at its own position, not shifted", () => {
    const answers = resolveResume(
      home,
      validateResumeRequests([
        { agent: "claude", cwd: "/tmp/w", lastSeenAt: T1 },
        { agent: "claude" }, // malformed: missing cwd/lastSeenAt
        { agent: "codex", cwd: "/tmp/codex", lastSeenAt: T1 },
      ]),
    );
    expect(answers).toEqual([{ kind: "id", id: "aaaa" }, null, { kind: "id", id: "cx1" }]);
  });
});

describe("validateResumeRequests", () => {
  it("(j) keeps well-formed entries and replaces malformed ones with positional nulls", () => {
    const raw = [
      { agent: "claude", cwd: "/tmp/w", lastSeenAt: 123 },
      { agent: "claude", cwd: null, lastSeenAt: 456 },
      null,
      "not an object",
      { cwd: "/tmp/w", lastSeenAt: 123 }, // missing agent
      { agent: "", cwd: null, lastSeenAt: 123 }, // empty agent
      { agent: "claude", cwd: 42, lastSeenAt: 123 }, // wrong cwd type
      { agent: "claude", cwd: null, lastSeenAt: "soon" }, // wrong lastSeenAt type
      { agent: "claude", cwd: null, lastSeenAt: Number.NaN }, // non-finite
    ];
    expect(validateResumeRequests(raw)).toEqual([
      { agent: "claude", cwd: "/tmp/w", lastSeenAt: 123 },
      { agent: "claude", cwd: null, lastSeenAt: 456 },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("(k) non-array input answers an empty list", () => {
    expect(validateResumeRequests(null)).toEqual([]);
    expect(validateResumeRequests({ agent: "claude" })).toEqual([]);
  });
});
