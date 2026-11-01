import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scanClaude } from "./claude";
import { scanCodex, CODEX_RESTORE_SCAN } from "./codex";
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  CODEX_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_ROLLOUT_PREFIX,
  CODEX_SESSIONS_DIR,
  TRANSCRIPT_EXTENSION,
} from "../usage/model";

const T0 = Date.parse("2026-08-01T00:00:00Z");

function writeAt(filePath: string, contents: string, mtimeMs: number): void {
  writeFileSync(filePath, contents);
  utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

/** A `session_meta` line padded past 8 KiB, the way a real rollout's embedded
 *  base_instructions pads it (~18.6 KB measured, 2026-08-16). */
function codexMeta(id: string, cwd: string, source: unknown): string {
  return JSON.stringify({
    type: "session_meta",
    payload: {
      id,
      cwd,
      source,
      base_instructions: { text: "x".repeat(12_000) },
    },
  });
}

describe("scanCodex", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-scan-"));
    const live = path.join(home, CODEX_DIR, CODEX_SESSIONS_DIR, "2026", "08", "01");
    mkdirSync(live, { recursive: true });
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}cli${TRANSCRIPT_EXTENSION}`),
      [
        codexMeta("cli-id", "/work/repo", "cli"),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "text",
                text: "<environment_context>ignore me</environment_context>",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "text", text: "make the thing work" }],
          },
        }),
      ].join("\n"),
      T0 + 3000,
    );
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}exec${TRANSCRIPT_EXTENSION}`),
      codexMeta("exec-id", "/work/repo", "exec"),
      T0 + 2000,
    );
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}sub${TRANSCRIPT_EXTENSION}`),
      codexMeta("sub-id", "/work/repo", { subagent: { depth: 1 } }),
      T0 + 1000,
    );
    // No `source` key at all — the shape `resolve.test.ts` already writes.
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}legacy${TRANSCRIPT_EXTENSION}`),
      JSON.stringify({
        type: "session_meta",
        payload: { id: "legacy-id", cwd: "/work/repo" },
      }),
      T0 + 500,
    );
    const old = path.join(home, CODEX_DIR, CODEX_ARCHIVED_DIR);
    mkdirSync(old, { recursive: true });
    writeAt(
      path.join(old, `${CODEX_ROLLOUT_PREFIX}old${TRANSCRIPT_EXTENSION}`),
      codexMeta("old-id", "/work/repo", "cli"),
      T0,
    );
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  // The shipped bug: an 8 KiB head cannot parse an 18 KB session_meta line.
  it("parses a session_meta line larger than 8 KiB", () => {
    const result = scanCodex(home, CODEX_RESTORE_SCAN);
    expect(result.records.map((r) => r.id)).toContain("cli-id");
  });

  it("drops exec and subagent rollouts when interactiveOnly is set", () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      interactiveOnly: true,
    });
    const ids = result.records.map((r) => r.id);
    expect(ids).toContain("cli-id");
    expect(ids).not.toContain("exec-id");
    expect(ids).not.toContain("sub-id");
  });

  // `resolve.test.ts`'s own codex fixture writes `payload: { id, cwd }` with
  // NO `source` at all (verified 2026-08-16, resolve.test.ts:98). A filter
  // that requires a known-good marker would delete that session and break a
  // test this task must keep green — so the filter names what to REJECT.
  it("keeps a rollout whose session_meta carries no source field", () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      interactiveOnly: true,
    });
    expect(result.records.map((r) => r.id)).toContain("legacy-id");
  });

  it("drops archived rollouts when includeArchived is false", () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      includeArchived: false,
    });
    expect(result.records.map((r) => r.id)).not.toContain("old-id");
  });

  it("keeps archived rollouts by default, as restore always has", () => {
    const result = scanCodex(home, CODEX_RESTORE_SCAN);
    expect(result.records.map((r) => r.id)).toContain("old-id");
  });

  it("takes the first user turn that is not an injected context block as the title", () => {
    const result = scanCodex(home, { ...CODEX_RESTORE_SCAN, withTitle: true });
    const cli = result.records.find((r) => r.id === "cli-id");
    expect(cli?.title).toBe("make the thing work");
  });

  it("reports the pre-cap candidate total", () => {
    const result = scanCodex(home, { ...CODEX_RESTORE_SCAN, maxFiles: 1 });
    expect(result.records).toHaveLength(1);
    expect(result.total).toBe(5);
  });
});

// Codex compresses a rollout idle for a week into `<name>.jsonl.zst`; on the
// dev machine that was 1,822 of 1,943 rollouts, all gone from restore and
// history until the scan read them.
describe("scanCodex over compressed rollouts", () => {
  let home: string;
  let live: string;

  function userTurn(text: string): string {
    return JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "text", text }] },
    });
  }

  function writeCompressed(name: string, lines: readonly string[], mtimeMs: number): void {
    const filePath = path.join(live, name);
    writeFileSync(filePath, zstdCompressSync(Buffer.from(lines.join("\n"))));
    utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
  }

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-scan-zst-"));
    live = path.join(home, CODEX_DIR, CODEX_SESSIONS_DIR, "2026", "08", "01");
    mkdirSync(live, { recursive: true });
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("reads the id, cwd and title of a compressed rollout", () => {
    // Random padding does not compress, so the head read has to widen its
    // compressed window more than once before the first line is whole.
    const meta = JSON.parse(codexMeta("zst-id", "/work/zst", "cli"));
    meta.payload.base_instructions.text = randomBytes(36_000).toString("base64");
    writeCompressed(
      `${CODEX_ROLLOUT_PREFIX}zst${TRANSCRIPT_EXTENSION}.zst`,
      [JSON.stringify(meta), userTurn("resume the old work")],
      T0,
    );

    const result = scanCodex(home, { ...CODEX_RESTORE_SCAN, withTitle: true });

    expect(result.records).toEqual([
      expect.objectContaining({ id: "zst-id", cwd: "/work/zst", title: "resume the old work" }),
    ]);
  });

  it("lists a rollout once while Codex has it both plain and compressed", () => {
    const name = `${CODEX_ROLLOUT_PREFIX}both${TRANSCRIPT_EXTENSION}`;
    writeAt(path.join(live, name), codexMeta("both-id", "/work/plain", "cli"), T0 + 1000);
    writeCompressed(`${name}.zst`, [codexMeta("both-id", "/work/compressed", "cli")], T0);

    const result = scanCodex(home, CODEX_RESTORE_SCAN);

    expect(result.total).toBe(1);
    expect(result.records).toEqual([expect.objectContaining({ cwd: "/work/plain" })]);
  });
});

describe("scanClaude", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-scan-claude-"));
    const project = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, "-work-repo");
    mkdirSync(project, { recursive: true });
    writeAt(
      path.join(project, `sid${TRANSCRIPT_EXTENSION}`),
      [
        JSON.stringify({ type: "last-prompt", sessionId: "sid" }),
        JSON.stringify({ type: "mode", sessionId: "sid" }),
        JSON.stringify({ type: "system", sessionId: "sid", cwd: "/work/repo" }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "not a prompt" }],
          },
        }),
        ...[
          "<local-command-caveat>The command below was run directly</local-command-caveat>",
          "<command-name>/model</command-name>",
          "<local-command-stdout>Set model</local-command-stdout>",
        ].map((content) => JSON.stringify({ type: "user", message: { role: "user", content } })),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "ship the feature" },
        }),
      ].join("\n"),
      T0,
    );
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("reads the session id from line one and the cwd from a later line", () => {
    const [record] = scanClaude(home, {
      maxFiles: 10,
      headBytes: 64 * 1024,
      headLines: 60,
      withTitle: false,
    }).records;
    expect(record.id).toBe("sid");
    expect(record.cwd).toBe("/work/repo");
    expect(record.sourcePath.endsWith(`sid${TRANSCRIPT_EXTENSION}`)).toBe(true);
  });

  it("skips tool_result and slash-command user lines when picking a title", () => {
    const [record] = scanClaude(home, {
      maxFiles: 10,
      headBytes: 64 * 1024,
      headLines: 60,
      withTitle: true,
    }).records;
    expect(record.title).toBe("ship the feature");
  });
});

describe("scanClaude across calls", () => {
  let home: string;
  let project: string;
  const options = { maxFiles: 10, headBytes: 64 * 1024, headLines: 60, withTitle: false };

  function transcript(name: string, lines: object[], mtimeMs: number): string {
    const file = path.join(project, `${name}${TRANSCRIPT_EXTENSION}`);
    writeAt(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", mtimeMs);
    return file;
  }

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "sessions-scan-claude-calls-"));
    project = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, "-work-repo");
    mkdirSync(project, { recursive: true });
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("keeps id and cwd when the transcript grows and reports the new mtime", () => {
    const file = transcript("grow", [{ sessionId: "grow", cwd: "/work/repo" }], T0);
    expect(scanClaude(home, options).records[0]).toMatchObject({ id: "grow", mtimeMs: T0 });
    appendFileSync(file, JSON.stringify({ type: "assistant", sessionId: "grow" }) + "\n");
    utimesSync(file, (T0 + 90_000) / 1000, (T0 + 90_000) / 1000);
    const [record] = scanClaude(home, options).records;
    expect(record).toMatchObject({ id: "grow", cwd: "/work/repo", mtimeMs: T0 + 90_000 });
  });

  it("drops a deleted transcript from the next answer", () => {
    const file = transcript("gone", [{ sessionId: "gone", cwd: "/work/repo" }], T0);
    transcript("kept", [{ sessionId: "kept", cwd: "/work/repo" }], T0 - 1000);
    expect(scanClaude(home, options).records.map((r) => r.id)).toEqual(["gone", "kept"]);
    rmSync(file);
    const result = scanClaude(home, options);
    expect(result.records.map((r) => r.id)).toEqual(["kept"]);
    expect(result.total).toBe(1);
  });

  it("finds a cwd that arrives after an earlier call saw none", () => {
    const file = transcript("late", [{ sessionId: "late" }], T0);
    expect(scanClaude(home, options).records[0]).toMatchObject({ id: "late", cwd: null });
    appendFileSync(
      file,
      JSON.stringify({ type: "system", sessionId: "late", cwd: "/work/late" }) + "\n",
    );
    // Same mtime on purpose: the size change alone must invalidate the miss.
    utimesSync(file, T0 / 1000, T0 / 1000);
    expect(scanClaude(home, options).records[0]).toMatchObject({ id: "late", cwd: "/work/late" });
  });

  it("finds a session id that arrives after an earlier call saw an empty file", () => {
    const file = transcript("empty", [], T0);
    expect(scanClaude(home, options).records).toEqual([]);
    writeAt(file, JSON.stringify({ sessionId: "empty", cwd: "/work/repo" }) + "\n", T0 + 1000);
    expect(scanClaude(home, options).records[0]).toMatchObject({ id: "empty", cwd: "/work/repo" });
  });

  it("forgets files that left the listing, so a recreated path is read fresh", () => {
    const file = transcript("reuse", [{ sessionId: "reuse", cwd: "/work/one" }], T0);
    expect(scanClaude(home, options).records[0].cwd).toBe("/work/one");
    rmSync(file);
    expect(scanClaude(home, options).records).toEqual([]);
    transcript("reuse", [{ sessionId: "reuse", cwd: "/work/two" }], T0);
    expect(scanClaude(home, options).records[0].cwd).toBe("/work/two");
  });

  it("does not read a transcript again once its head named a cwd", () => {
    transcript("once", [{ sessionId: "once", cwd: "/work/one" }], T0);
    expect(scanClaude(home, options).records[0].cwd).toBe("/work/one");
    // A real head never changes; rewriting it is how a test sees the read skipped.
    transcript("once", [{ sessionId: "once", cwd: "/work/two" }], T0 + 1000);
    const [record] = scanClaude(home, options).records;
    expect(record).toMatchObject({ cwd: "/work/one", mtimeMs: T0 + 1000 });
  });

  it("forgets a transcript that fell out of the maxFiles window", () => {
    const narrow = { ...options, maxFiles: 1 };
    transcript("old", [{ sessionId: "old", cwd: "/work/one" }], T0);
    expect(scanClaude(home, narrow).records[0].id).toBe("old");
    transcript("new", [{ sessionId: "new", cwd: "/work/repo" }], T0 + 1000);
    expect(scanClaude(home, narrow).records[0].id).toBe("new");
    transcript("old", [{ sessionId: "old", cwd: "/work/two" }], T0 + 2000);
    expect(scanClaude(home, narrow).records[0]).toMatchObject({ id: "old", cwd: "/work/two" });
  });

  // chmod does not lock out root, and Windows has no mode bits to clear.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reads a transcript again after a read failed, even at the same mtime and size",
    () => {
      const file = transcript("locked", [{ sessionId: "locked", cwd: "/work/repo" }], T0);
      chmodSync(file, 0o000);
      try {
        expect(scanClaude(home, options).records).toEqual([]);
      } finally {
        chmodSync(file, 0o644);
      }
      utimesSync(file, T0 / 1000, T0 / 1000);
      expect(scanClaude(home, options).records[0]).toMatchObject({ id: "locked" });
    },
  );
});
