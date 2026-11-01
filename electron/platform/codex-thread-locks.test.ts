import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { parseCodexLocks, selectCodexThread, processCodexSessions } from "./codex-thread-locks";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
const HOME = "/home/test";
const MAIN = "01900000-0000-7000-8000-000000000001";
const CHILD = "01900000-0000-7000-8000-000000000002";
const lock = (id: string) => `n${HOME}/.codex/thread-writer-locks/${id}.lock`;
afterEach(() => vi.resetAllMocks());

describe("Codex thread writer locks", () => {
  it("joins unique lock ids to their process, ignoring other paths and malformed ids", () => {
    const locks = parseCodexLocks(
      [
        "p42",
        "fcwd",
        `n${HOME}`,
        "f7",
        lock(MAIN),
        "f8",
        lock(MAIN),
        "p43",
        lock(CHILD),
        "pbad",
        lock(MAIN),
        "p44",
        lock("invalid"),
        "n/tmp/.codex/thread-writer-locks/01900000-0000-7000-8000-000000000001.lock",
      ].join("\n"),
      HOME,
    );
    expect(locks).toEqual(
      new Map([
        [42, [MAIN]],
        [43, [CHILD]],
      ]),
    );
  });
  it("identifies one lock before a rollout exists", () => {
    expect(selectCodexThread([MAIN], new Set())).toBe(MAIN);
    expect(selectCodexThread([], new Set())).toBeNull();
  });
  it("requires exactly one verified interactive main thread among multiple locks", () => {
    expect(selectCodexThread([MAIN, CHILD], new Set([MAIN]))).toBe(MAIN);
    expect(selectCodexThread([MAIN, CHILD], new Set())).toBeNull();
    expect(selectCodexThread([MAIN, CHILD], new Set([MAIN, CHILD]))).toBeNull();
  });
  it("batches pids once with bounded lsof and does not need a rollout for one lock", async () => {
    vi.mocked(execFile).mockImplementation(((
      _file: unknown,
      _args: unknown,
      _opts: unknown,
      cb: Function,
    ) => {
      cb(null, `p42\n${lock(MAIN)}\np43\n${lock(CHILD)}\n`);
    }) as typeof execFile);
    expect(
      await processCodexSessions(
        new Map([
          [42, []],
          [43, []],
        ]),
        HOME,
        "darwin",
      ),
    ).toEqual(
      new Map([
        [42, MAIN],
        [43, CHILD],
      ]),
    );
    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
      "/usr/sbin/lsof",
      ["-nP", "-p", "42,43", "-Fpn"],
      expect.objectContaining({ timeout: expect.any(Number), maxBuffer: expect.any(Number) }),
      expect.any(Function),
    );
  });
  // npm's `codex` is a `node` launcher; the native child it spawns holds the lock.
  it("counts a lock held by another codex process in the foreground group as the leader's", async () => {
    vi.mocked(execFile).mockImplementation(((
      _file: unknown,
      _args: unknown,
      _opts: unknown,
      cb: Function,
    ) => {
      cb(null, `p43\n${lock(MAIN)}\n`);
    }) as typeof execFile);
    expect(await processCodexSessions(new Map([[42, [43]]]), HOME, "darwin")).toEqual(
      new Map([[42, MAIN]]),
    );
    expect(execFile).toHaveBeenCalledWith(
      "/usr/sbin/lsof",
      ["-nP", "-p", "42,43", "-Fpn"],
      expect.any(Object),
      expect.any(Function),
    );
  });
  it("fails closed on missing lsof or partial output from a failed command", async () => {
    vi.mocked(execFile).mockImplementation(((
      _file: unknown,
      _args: unknown,
      _opts: unknown,
      cb: Function,
    ) => {
      cb(Object.assign(new Error("lsof unavailable"), { code: "ENOENT" }), `p42\n${lock(MAIN)}\n`);
    }) as typeof execFile);
    expect(await processCodexSessions(new Map([[42, []]]), HOME, "linux")).toEqual(new Map());
  });
  it.each([
    ["cli", { subagent: { parent_thread_id: MAIN } }, MAIN],
    ["cli", "vscode", null],
    [undefined, { subagent: {} }, null],
    ["exec", { subagent: {} }, null],
  ])(
    "reads actual rollout metadata to distinguish main from subagent (%j, %j)",
    async (source, childSource, expected) => {
      const home = mkdtempSync(path.join(tmpdir(), "deck-codex-locks-"));
      try {
        const dir = path.join(home, ".codex", "sessions");
        mkdirSync(dir, { recursive: true });
        for (const [id, value] of [
          [MAIN, source],
          [CHILD, childSource],
        ]) {
          writeFileSync(
            path.join(dir, `rollout-${id}.jsonl`),
            JSON.stringify({
              type: "session_meta",
              payload: { id, source: value, cwd: "/w" },
            }) + "\n",
          );
        }
        vi.mocked(execFile).mockImplementation(((
          _file: unknown,
          _args: unknown,
          _opts: unknown,
          cb: Function,
        ) => {
          cb(
            null,
            `p42\nn${home}/.codex/thread-writer-locks/${MAIN}.lock\nn${home}/.codex/thread-writer-locks/${CHILD}.lock\n`,
          );
        }) as typeof execFile);
        expect(
          (await processCodexSessions(new Map([[42, []]]), home, "darwin")).get(42) ?? null,
        ).toBe(expected);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it("does not launch lsof on Windows or for an empty batch", async () => {
    expect(await processCodexSessions(new Map([[42, []]]), HOME, "win32")).toEqual(new Map());
    expect(await processCodexSessions(new Map(), HOME, "darwin")).toEqual(new Map());
    expect(execFile).not.toHaveBeenCalled();
  });
});
