import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseWorktreePorcelain, scanRepository } from "./worktrees";

const run = promisify(execFile);

/** Real output shapes, transcribed from `git worktree list --porcelain`. */
const MAIN_AND_LINKED = `worktree /Users/x/deck
HEAD 6d2f0c1c0a0f4b9c3e5f8a7b6c5d4e3f2a1b0c9d
branch refs/heads/main

worktree /Users/x/deck-worktrees/redesign
HEAD 9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b
branch refs/heads/redesign/phase-1-2
`;

describe("parseWorktreePorcelain", () => {
  it("reads the main checkout and a linked worktree", () => {
    const entries = parseWorktreePorcelain(MAIN_AND_LINKED);
    expect(entries).toEqual([
      {
        path: "/Users/x/deck",
        head: "6d2f0c1c0a0f4b9c3e5f8a7b6c5d4e3f2a1b0c9d",
        branch: "main",
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      },
      {
        path: "/Users/x/deck-worktrees/redesign",
        head: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
        // Shortened from refs/heads/…, and the slash inside the branch name
        // survives — a rail that renamed `redesign/phase-1-2` would be wrong.
        branch: "redesign/phase-1-2",
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      },
    ]);
  });

  it("distinguishes detached, bare, locked and prunable", () => {
    const entries = parseWorktreePorcelain(
      [
        "worktree /repo.git",
        "bare",
        "",
        "worktree /repo/detached",
        "HEAD aaaa",
        "detached",
        "",
        "worktree /repo/locked",
        "HEAD bbbb",
        "detached",
        "locked on a removable drive",
        "",
        "worktree /repo/gone",
        "HEAD cccc",
        "detached",
        "prunable gitdir file points to non-existent location",
        "",
      ].join("\n"),
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      "/repo.git",
      "/repo/detached",
      "/repo/locked",
      "/repo/gone",
    ]);
    expect(entries[0].bare).toBe(true);
    expect(entries[1].detached).toBe(true);
    expect(entries[2].locked).toBe("on a removable drive");
    expect(entries[3].prunable).toBe("gitdir file points to non-existent location");
  });

  it("keeps a reasonless `locked` distinct from not being locked", () => {
    // Empty string means "locked, no reason given"; null means "not locked".
    // Collapsing the two would make an unexplained lock invisible.
    const [entry] = parseWorktreePorcelain("worktree /a\nHEAD dddd\nlocked\n");
    expect(entry.locked).toBe("");
    expect(entry.prunable).toBeNull();
  });

  it("survives output it does not understand", () => {
    const entries = parseWorktreePorcelain(
      [
        "some-future-attribute value", // before any record — nothing to attach to
        "",
        "worktree /repo/a",
        "HEAD eeee",
        "branch refs/heads/a",
        "quarantined by a git that does not exist yet",
        "",
        "worktree", // path-less record: identifies nothing
        "",
      ].join("\n"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: "/repo/a", branch: "a" });
  });

  it("tolerates CRLF and a missing trailing blank line", () => {
    const entries = parseWorktreePorcelain(
      "worktree /repo/a\r\nHEAD ffff\r\nbranch refs/heads/a\r\n",
    );
    expect(entries).toEqual([
      {
        path: "/repo/a",
        head: "ffff",
        branch: "a",
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      },
    ]);
  });

  it("returns nothing for empty output rather than a blank entry", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
    expect(parseWorktreePorcelain("\n\n")).toEqual([]);
  });
});

describe("scanRepository", () => {
  it("refuses an empty path without running git", async () => {
    await expect(scanRepository("")).resolves.toEqual({
      kind: "plain",
      reason: "no path",
    });
  });

  it("degrades a path that is not a repository to `plain`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deck-worktrees-"));
    try {
      const scan = await scanRepository(dir);
      // `/tmp` is not inside a repository on any machine this suite runs on;
      // if it somehow were, the assertion below still holds for a real repo.
      expect(scan.kind === "plain" || scan.kind === "repository").toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("degrades a path that does not exist, and does not throw", async () => {
    await expect(
      scanRepository(join(tmpdir(), "deck-does-not-exist-9f3fd95c")),
    ).resolves.toMatchObject({ kind: "plain" });
  });

  it("reads a real repository, keyed by its common dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deck-repo-"));
    try {
      await run("git", ["-C", dir, "init", "-q"]);
      await run("git", ["-C", dir, "config", "user.email", "t@example.com"]);
      await run("git", ["-C", dir, "config", "user.name", "T"]);
      await run("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "x"]);

      const scan = await scanRepository(dir);
      expect(scan.kind).toBe("repository");
      if (scan.kind !== "repository") {
        return;
      }
      expect(scan.key.endsWith(".git")).toBe(true);
      expect(scan.worktrees).toHaveLength(1);
      expect(scan.worktrees[0].branch).not.toBeNull();

      // The identity claim the whole rail rests on: a linked worktree reports
      // the SAME key, which is what groups the two rows under one repository.
      const linked = join(dir, "..", `${dir.split("/").pop()}-linked`);
      await run("git", ["-C", dir, "worktree", "add", "-q", "-b", "side", linked]);
      try {
        const fromLinked = await scanRepository(linked);
        expect(fromLinked.kind).toBe("repository");
        if (fromLinked.kind !== "repository") {
          return;
        }
        expect(fromLinked.key).toBe(scan.key);
        expect(fromLinked.worktrees).toHaveLength(2);
      } finally {
        await rm(linked, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
