import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PathOutsideWorkspaceError } from "../fs/path-guard";
import {
  createChangesWatchRegistry,
  EMIT_INTERVAL_MS,
  findGitDir,
  keepsRootGitPath,
  type ChangesWatchFs,
} from "./changes-watch";

/**
 * The registry over a FAKE watcher: which events count, how they throttle and
 * what is released. Whether `fs.watch` fires is a platform question; the E2E
 * pass on macOS answers it.
 */
let base: string;
let plain: string;
let worktree: string;
let gitDirOutside: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deck-changes-watch-")));
  plain = path.join(base, "plain");
  fs.mkdirSync(path.join(plain, ".git"), { recursive: true });
  const main = path.join(base, "main-repo");
  gitDirOutside = path.join(main, ".git", "worktrees", "wt");
  fs.mkdirSync(gitDirOutside, { recursive: true });
  worktree = path.join(base, "wt");
  fs.mkdirSync(worktree);
  fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${gitDirOutside}\n`);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

interface FakeWatcher {
  readonly target: string;
  readonly recursive: boolean;
  closed: boolean;
  fire(filename: string | null): void;
  fail(error: unknown): void;
}

function fakeIo(): { io: ChangesWatchFs; watchers: FakeWatcher[] } {
  const watchers: FakeWatcher[] = [];
  const io: ChangesWatchFs = {
    watch(target, options, listener, onError) {
      const watcher: FakeWatcher = {
        target,
        recursive: options.recursive,
        closed: false,
        fire: (filename) => listener("rename", filename),
        fail: onError,
      };
      watchers.push(watcher);
      return {
        close() {
          watcher.closed = true;
        },
      };
    },
  };
  return { io, watchers };
}

function setup(recursive = true) {
  const { io, watchers } = fakeIo();
  const emit = vi.fn();
  const log = vi.fn();
  const registry = createChangesWatchRegistry({ emit, io, recursive, log });
  return { registry, watchers, emit, log };
}

const settle = () => vi.advanceTimersByTime(EMIT_INTERVAL_MS + 1);

describe("which watches open", () => {
  it("opens one recursive watch on a checkout whose .git is inside it", () => {
    const { registry, watchers } = setup();
    registry.replace(1, plain);
    expect(watchers.map((w) => [w.target, w.recursive])).toEqual([[plain, true]]);
  });

  it("adds a non-recursive watch on a git directory outside the root", () => {
    const { registry, watchers } = setup();
    registry.replace(1, worktree);
    expect(watchers.map((w) => [w.target, w.recursive])).toEqual([
      [worktree, true],
      [gitDirOutside, false],
    ]);
  });

  it("watches the root's own .git instead when recursion is unavailable", () => {
    const { registry, watchers } = setup(false);
    registry.replace(1, plain);
    expect(watchers.map((w) => [w.target, w.recursive])).toEqual([
      [path.join(plain, ".git"), false],
    ]);
  });

  it("replaces: closes the old watches, and null or release closes them too", () => {
    const { registry, watchers } = setup();
    registry.replace(1, plain);
    registry.replace(1, worktree);
    expect(watchers[0].closed).toBe(true);
    expect(registry.watched(1)).toEqual([worktree, gitDirOutside].sort());
    registry.replace(1, null);
    expect(watchers.every((w) => w.closed)).toBe(true);
    expect(registry.watched(1)).toEqual([]);
    registry.replace(2, plain);
    registry.release(2);
    expect(watchers[watchers.length - 1].closed).toBe(true);
  });

  it("keeps senders apart", () => {
    const { registry, watchers } = setup();
    registry.replace(1, plain);
    registry.replace(2, plain);
    registry.release(1);
    expect(watchers[0].closed).toBe(true);
    expect(watchers[1].closed).toBe(false);
  });

  it("throws for a root that does not resolve", () => {
    const { registry } = setup();
    expect(() => registry.replace(1, path.join(base, "missing"))).toThrow(
      PathOutsideWorkspaceError,
    );
  });

  it("degrades to no watch, logged once, when fs.watch throws", () => {
    const emit = vi.fn();
    const log = vi.fn();
    const io: ChangesWatchFs = {
      watch() {
        throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
      },
    };
    const registry = createChangesWatchRegistry({ emit, io, recursive: true, log });
    registry.replace(1, plain);
    registry.replace(1, plain);
    expect(registry.watched(1)).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("logs a watcher error event once", () => {
    const { registry, watchers, log } = setup();
    registry.replace(1, plain);
    watchers[0].fail(new Error("ENOSPC"));
    watchers[0].fail(new Error("ENOSPC"));
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("which events count", () => {
  const cases: ReadonlyArray<readonly [string, string | null, boolean]> = [
    ["a source file", "src/app.ts", true],
    ["a root-level file", "README.md", true],
    ["an unknown filename", null, true],
    ["the index", ".git/index", true],
    ["HEAD", ".git/HEAD", true],
    ["packed-refs", ".git/packed-refs", true],
    ["a branch ref", ".git/refs/heads/feat", true],
    ["the index lock", ".git/index.lock", false],
    ["a ref lock", ".git/refs/heads/feat.lock", false],
    ["objects", ".git/objects/ab/cdef", false],
    ["logs", ".git/logs/HEAD", false],
    ["worktrees", ".git/worktrees/wt/index", false],
    ["the .git entry itself", ".git", false],
    ["a Windows separator", "src\\app.ts", true],
  ];
  it.each(cases)("%s", (_name, filename, counts) => {
    vi.useFakeTimers();
    const { registry, watchers, emit } = setup();
    registry.replace(1, plain);
    watchers[0].fire(filename);
    settle();
    expect(emit).toHaveBeenCalledTimes(counts ? 1 : 0);
  });

  it("keeps only index and HEAD from a git directory outside the root", () => {
    vi.useFakeTimers();
    const { registry, watchers, emit } = setup();
    registry.replace(1, worktree);
    const gitWatch = watchers[1];
    for (const filename of ["objects", "index.lock", "logs", "refs", "worktrees"]) {
      gitWatch.fire(filename);
    }
    settle();
    expect(emit).not.toHaveBeenCalled();
    gitWatch.fire("index");
    settle();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(1, worktree);
    gitWatch.fire("HEAD");
    settle();
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe("throttle", () => {
  it("emits once for 5,000 events inside 100 ms", () => {
    vi.useFakeTimers();
    const { registry, watchers, emit } = setup();
    registry.replace(1, plain);
    for (let index = 0; index < 5000; index += 1) {
      watchers[0].fire(`node_modules/p${index}/index.js`);
    }
    vi.advanceTimersByTime(EMIT_INTERVAL_MS - 1);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(emit).toHaveBeenCalledTimes(1);
    watchers[0].fire("a.ts");
    settle();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("drops a pending emit when the sender is released", () => {
    vi.useFakeTimers();
    const { registry, watchers, emit } = setup();
    registry.replace(1, plain);
    watchers[0].fire("a.ts");
    registry.release(1);
    settle();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("keepsRootGitPath", () => {
    expect(keepsRootGitPath([])).toBe(false);
    expect(keepsRootGitPath(["index"])).toBe(true);
    expect(keepsRootGitPath(["refs", "tags", "v1"])).toBe(true);
    expect(keepsRootGitPath(["objects", "pack"])).toBe(false);
  });

  it("findGitDir walks up from a subdirectory and follows a gitdir pointer", () => {
    const sub = path.join(plain, "pkg", "deep");
    fs.mkdirSync(sub, { recursive: true });
    expect(findGitDir(sub)).toBe(path.join(plain, ".git"));
    expect(findGitDir(worktree)).toBe(gitDirOutside);
  });
});
