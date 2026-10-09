import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countLines,
  MAX_ENTRIES,
  parseNumstat,
  parseStatus,
  readChanges,
  type ChangesSnapshot,
  type GitRunner,
} from "./changes";

/** An explicit environment with no `GIT_*` of ours: the pre-push hook runs this
 * suite with its own `GIT_DIR`, and a leak would rewrite the real repository. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) {
      env[key] = value;
    }
  }
  return {
    ...env,
    LC_ALL: "C",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { env: gitEnv(), encoding: "utf8" });
}

function write(root: string, name: string, text: string | Buffer): void {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

function initRepo(root: string): void {
  git(root, "init", "-q", "-b", "main");
}

function commitAll(root: string, message = "c"): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

let scratch: string;
let repo: string;

beforeEach(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deck-changes-")));
  repo = path.join(scratch, "repo");
  fs.mkdirSync(repo);
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

async function snapshot(root = repo): Promise<ChangesSnapshot> {
  const reply = await readChanges(root);
  if (reply.kind !== "changes") {
    throw new Error(`expected a snapshot, got ${reply.kind}: ${reply.message}`);
  }
  return reply;
}

describe("readChanges on a repository", () => {
  it("reports every CHG1 status with the counts git prints", async () => {
    initRepo(repo);
    write(repo, "mod.txt", "a\nb\nc\n");
    write(repo, "del.txt", "x\ny\n");
    write(repo, "ren-old.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
    write(repo, "bin.dat", Buffer.from([0, 1, 2, 3]));
    commitAll(repo);

    write(repo, "mod.txt", "a\nB\nc\nd\n");
    fs.rmSync(path.join(repo, "del.txt"));
    git(repo, "mv", "ren-old.txt", "ren-new.txt");
    write(repo, "bin.dat", Buffer.from([0, 9, 9, 9, 9]));
    write(repo, "added.txt", "n1\nn2\n");
    git(repo, "add", "added.txt");
    write(repo, "loose.txt", "u1\nu2\nu3");
    write(repo, "loose.bin", Buffer.from([0, 0, 1]));

    const result = await snapshot();
    const byPath = new Map(result.entries.map((entry) => [entry.path, entry]));

    expect(result.branch).toBe("main");
    expect(result.detached).toBe(false);
    expect(result.initial).toBe(false);
    expect(result.omitted).toBe(0);
    expect(byPath.get("mod.txt")).toMatchObject({ status: "modified", added: 2, removed: 1 });
    expect(byPath.get("del.txt")).toMatchObject({ status: "deleted", added: 0, removed: 2 });
    expect(byPath.get("ren-new.txt")).toMatchObject({
      status: "renamed",
      oldPath: "ren-old.txt",
      added: 0,
      removed: 0,
    });
    expect(byPath.get("bin.dat")).toMatchObject({ status: "modified", binary: true });
    expect(byPath.get("added.txt")).toMatchObject({ status: "added", added: 2, removed: 0 });
    // Untracked files count every line as added, including an unterminated last one.
    expect(byPath.get("loose.txt")).toMatchObject({ status: "untracked", added: 3, removed: 0 });
    expect(byPath.get("loose.bin")).toMatchObject({ status: "untracked", binary: true });

    const numstat = git(repo, "diff", "--numstat", "HEAD");
    const expectedAdded = numstat
      .split("\n")
      .filter(Boolean)
      .reduce((sum, line) => sum + (Number(line.split("\t")[0]) || 0), 0);
    // Tracked sum from git, plus the three untracked lines.
    expect(result.totals.added).toBe(expectedAdded + 3);
  });

  it("shows a file that is staged and unstaged against HEAD once, with the combined counts", async () => {
    initRepo(repo);
    write(repo, "both.txt", "1\n2\n3\n");
    commitAll(repo);
    write(repo, "both.txt", "1\n2\n3\n4\n");
    git(repo, "add", "both.txt");
    write(repo, "both.txt", "1\n2\n3\n4\n5\n");

    const result = await snapshot();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ path: "both.txt", status: "modified", added: 2 });
  });

  it("compares a repository with no commit against the empty tree", async () => {
    initRepo(repo);
    write(repo, "staged.txt", "s1\ns2\n");
    git(repo, "add", "staged.txt");
    write(repo, "untracked.txt", "u\n");

    const result = await snapshot();
    expect(result.initial).toBe(true);
    expect(result.branch).toBe("main");
    const byPath = new Map(result.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("staged.txt")).toMatchObject({ status: "added", added: 2 });
    expect(byPath.get("untracked.txt")).toMatchObject({ status: "untracked", added: 1 });
  });

  it("names the commit when HEAD is detached", async () => {
    initRepo(repo);
    write(repo, "a.txt", "a\n");
    commitAll(repo);
    git(repo, "checkout", "-q", "--detach");

    const result = await snapshot();
    expect(result.detached).toBe(true);
    expect(result.branch).toBeNull();
    expect(result.oid).toMatch(/^[0-9a-f]{7}$/);
    expect(result.entries).toEqual([]);
  });

  it("scopes to a workspace below the top level and maps paths into it", async () => {
    initRepo(repo);
    write(repo, "top.txt", "t\n");
    write(repo, "pkg/inner.txt", "i\n");
    write(repo, "pkg/sub/deep.txt", "d\n");
    commitAll(repo);
    write(repo, "top.txt", "t\nchanged\n");
    write(repo, "pkg/inner.txt", "i\nchanged\n");
    write(repo, "pkg/sub/new.txt", "n\n");

    const result = await snapshot(path.join(repo, "pkg"));
    expect(result.entries.map((entry) => entry.path).sort()).toEqual(["inner.txt", "sub/new.txt"]);
  });

  it("handles spaces, newlines and non-ASCII in paths", async () => {
    initRepo(repo);
    write(repo, "with space.txt", "a\n");
    write(repo, "line\nbreak.txt", "a\n");
    write(repo, "naïve/日本.txt", "a\n");
    commitAll(repo);
    write(repo, "with space.txt", "a\nb\n");
    write(repo, "line\nbreak.txt", "a\nb\n");
    write(repo, "naïve/日本.txt", "a\nb\n");

    const result = await snapshot();
    expect(result.entries.map((entry) => entry.path).sort()).toEqual([
      "line\nbreak.txt",
      "naïve/日本.txt",
      "with space.txt",
    ]);
    expect(result.entries.every((entry) => entry.added === 1)).toBe(true);
  });

  it("caps the entries and says how many it is not showing", async () => {
    initRepo(repo);
    write(repo, "seed.txt", "s\n");
    commitAll(repo);
    for (let index = 0; index < MAX_ENTRIES + 7; index += 1) {
      write(repo, `many/f${String(index).padStart(4, "0")}.txt`, "x\n");
    }

    const result = await snapshot();
    expect(result.entries).toHaveLength(MAX_ENTRIES);
    expect(result.omitted).toBe(7);
  });

  it("does not rewrite the index when it reads", async () => {
    initRepo(repo);
    write(repo, "a.txt", "aaaa\n");
    commitAll(repo);
    // Same size, new mtime: a plain `git status` would refresh and rewrite the index.
    const future = new Date(Date.now() + 5000);
    write(repo, "a.txt", "bbbb\n");
    fs.utimesSync(path.join(repo, "a.txt"), future, future);
    const index = path.join(repo, ".git", "index");
    const before = fs.statSync(index);

    await snapshot();

    const after = fs.statSync(index);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(fs.existsSync(`${index}.lock`)).toBe(false);
  });

  it("ignores GIT_* variables inherited from the caller", async () => {
    initRepo(repo);
    write(repo, "a.txt", "a\n");
    commitAll(repo);
    write(repo, "a.txt", "a\nb\n");
    const elsewhere = path.join(scratch, "elsewhere");
    fs.mkdirSync(elsewhere);
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(elsewhere, ".git");
    try {
      const result = await snapshot();
      expect(result.entries.map((entry) => entry.path)).toEqual(["a.txt"]);
    } finally {
      if (saved === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = saved;
      }
    }
  });
});

describe("readChanges failures", () => {
  it("says not-repository for a plain folder", async () => {
    const reply = await readChanges(repo);
    expect(reply).toMatchObject({ kind: "not-repository", message: "Not a git repository" });
  });

  it("says failed for a root that cannot be resolved", async () => {
    const reply = await readChanges(path.join(scratch, "missing"));
    expect(reply.kind).toBe("failed");
  });

  it.each([
    ["git-missing", "Git is not installed"],
    ["timeout", "took longer"],
    ["overflow", "too large"],
  ] as const)("reports %s from the runner", async (kind, fragment) => {
    const run: GitRunner = async () => ({ ok: false, kind, stderr: "" });
    const reply = await readChanges(repo, { run });
    expect(reply.kind).toBe(kind);
    expect(reply.kind === "changes" ? "" : reply.message).toContain(fragment);
  });

  it("uses the first stderr line for an unclassified failure", async () => {
    const run: GitRunner = async () => ({
      ok: false,
      kind: "failed",
      stderr: "\nfatal: boom\nmore",
    });
    expect(await readChanges(repo, { run })).toEqual({ kind: "failed", message: "fatal: boom" });
  });

  it("carries a failure from a later command, too", async () => {
    let calls = 0;
    const run: GitRunner = async (args) => {
      calls += 1;
      if (args[0] === "rev-parse") {
        return { ok: true, stdout: `${repo}\n${repo}/.git\n\n` };
      }
      return { ok: false, kind: "timeout", stderr: "" };
    };
    expect((await readChanges(repo, { run })).kind).toBe("timeout");
    expect(calls).toBe(2);
  });

  it("only ever asks for read-only verbs and passes --no-optional-locks via the real runner", async () => {
    initRepo(repo);
    write(repo, "a.txt", "a\n");
    const verbs: string[] = [];
    const run: GitRunner = async (args) => {
      verbs.push(args[0]);
      expect(args).not.toContain("-w");
      return {
        ok: true,
        stdout: args[0] === "rev-parse" ? `${repo}\n${repo}/.git\n\n` : "",
      };
    };
    await readChanges(repo, { run });
    expect(new Set(verbs)).toEqual(new Set(["rev-parse", "status", "diff"]));
  });
});

describe("parsers", () => {
  it("parseStatus skips an unknown record and keeps the rest", () => {
    const stdout = [
      "# branch.oid abcdef0123456789",
      "# branch.head feat/x",
      "1 .M N... 100644 100644 100644 aaa bbb dir/a b.txt",
      "z mystery record",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.txt",
      "old.txt",
      "? loose.txt",
      "! ignored.txt",
      "",
    ].join("\0");
    const { header, records } = parseStatus(stdout);
    expect(header).toEqual({ oid: "abcdef0123456789", head: "feat/x", initial: false });
    expect(records).toEqual([
      { status: "modified", path: "dir/a b.txt", oldPath: null },
      { status: "renamed", path: "new.txt", oldPath: "old.txt" },
      { status: "untracked", path: "loose.txt", oldPath: null },
    ]);
  });

  it("parseNumstat reads binary markers and rename triples", () => {
    const stdout = ["3\t1\ta.txt", "-\t-\tbin.dat", "0\t0\t", "old.txt", "new.txt", ""].join("\0");
    const map = parseNumstat(stdout);
    expect(map.get("a.txt")).toEqual({ added: 3, removed: 1, binary: false });
    expect(map.get("bin.dat")).toEqual({ added: 0, removed: 0, binary: true });
    expect(map.get("new.txt")).toEqual({ added: 0, removed: 0, binary: false });
    expect(map.has("old.txt")).toBe(false);
  });

  it("countLines counts an unterminated last line", () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(countLines(bytes(""))).toBe(0);
    expect(countLines(bytes("a\n"))).toBe(1);
    expect(countLines(bytes("a\nb"))).toBe(2);
  });
});
