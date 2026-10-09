import { describe, expect, it } from "vitest";
import type { RepositoryScan } from "../../repositories/repository-client";
import { deckScans, row, worktree } from "./dev-server-fixtures";
import { devServerRoots, inScope, subjectFor } from "./dev-server-scope";

const scans = deckScans();
const subject = subjectFor("/w/deck", scans);

describe("devServerRoots", () => {
  it("is the open tabs plus the recents, one spelling each, sorted", () => {
    expect(devServerRoots(["/w/b/", null, "/w/a"], ["/w/a/", "/w/c", ""])).toEqual([
      "/w/a",
      "/w/b",
      "/w/c",
    ]);
  });

  it("is the same list when the tabs republish unchanged", () => {
    expect(devServerRoots(["/w/a", "/w/b"], [])).toEqual(devServerRoots(["/w/b", "/w/a"], []));
  });

  it("adds the worktrees of every scanned repository, even ones nobody opened", () => {
    const nested = "/w/deck/.claude/worktrees/x";
    const scan: RepositoryScan = {
      kind: "repository",
      key: "/w/deck/.git",
      root: "/w/deck",
      worktrees: [
        worktree("/w/deck", "main"),
        worktree(nested, "x"),
        { ...worktree("/w/gone", "gone"), prunable: "gitdir file points to non-existent location" },
      ],
    };

    expect(devServerRoots(["/w/deck"], [], new Map([["/w/deck", scan]]))).toEqual([
      "/w/deck",
      nested,
    ]);
  });

  it("sends only roots main accepts: absolute, no NUL, at most 4096 characters", () => {
    const roots = devServerRoots(
      ["relative/dir", "/w/ok", "/w/bad\0nul", `/${"a".repeat(4096)}`],
      ["~/home", "/w/also-ok"],
    );
    expect(roots).toEqual(["/w/also-ok", "/w/ok"]);
  });

  it("caps at 64 roots, keeping open tabs, then worktrees, then recents", () => {
    const tabs = Array.from({ length: 3 }, (_, i) => `/t/${i}`);
    const many = Array.from({ length: 70 }, (_, i) => worktree(`/r/wt-${i}`, `b${i}`));
    const scan: RepositoryScan = {
      kind: "repository",
      key: "/r/.git",
      root: "/r",
      worktrees: many,
    };
    const recents = Array.from({ length: 10 }, (_, i) => `/recent/${i}`);

    const roots = devServerRoots([...tabs, "/r"], recents, new Map([["/r", scan]]));

    expect(roots).toHaveLength(64);
    expect(tabs.every((path) => roots.includes(path))).toBe(true);
    expect(roots).toContain("/r/wt-59");
    expect(roots).not.toContain("/r/wt-60");
    expect(roots.some((path) => path.startsWith("/recent/"))).toBe(false);
  });
});

describe("subjectFor", () => {
  it("names the repository and the checkout's branch", () => {
    expect(subjectFor("/w/deck-redesign", scans)).toMatchObject({
      name: "deck",
      branch: "redesign",
      worktree: "/w/deck-redesign",
    });
  });

  it("names the project after the primary checkout, not the folder the scan ran in", () => {
    const entries = [worktree("/w/alpha", "master"), worktree("/w/alpha-wt", "wt")];
    // A scan taken from the linked worktree reports that worktree as its root.
    const fromLinked: RepositoryScan = {
      kind: "repository",
      key: "/w/alpha/.git",
      root: "/w/alpha-wt",
      worktrees: entries,
    };

    const linked = subjectFor("/w/alpha-wt", new Map([["/w/alpha-wt", fromLinked]]));
    expect(linked).toMatchObject({ name: "alpha", branch: "wt", worktree: "/w/alpha-wt" });

    // The main checkout's tab read through that same scan keeps its own branch.
    const main = subjectFor("/w/alpha", new Map([["/w/alpha", fromLinked]]));
    expect(main).toMatchObject({ name: "alpha", branch: "master", worktree: "/w/alpha" });
    expect(inScope(row({ displayRoot: "/w/alpha" }), "worktree", main, new Map())).toBe(true);
    expect(inScope(row({ displayRoot: "/w/alpha-wt" }), "worktree", main, new Map())).toBe(false);
  });

  it("falls back to the folder when git has not scanned it", () => {
    expect(subjectFor("/w/notes", new Map())).toMatchObject({
      name: "notes",
      branch: null,
      worktree: "/w/notes",
      scan: null,
    });
  });

  it("is honest about having no folder", () => {
    expect(subjectFor(null, scans)).toMatchObject({
      path: null,
      name: "No folder",
      worktree: null,
    });
  });
});

describe("inScope", () => {
  const main = row({ id: "m", displayRoot: "/w/deck" });
  const redesign = row({ id: "r", displayRoot: "/w/deck-redesign" });
  const other = row({ id: "o", displayRoot: "/w/api" });

  it("narrows to the active checkout, then its repository, then everything", () => {
    const pick = (scope: "worktree" | "project" | "all") =>
      [main, redesign, other].filter((r) => inScope(r, scope, subject, scans)).map((r) => r.id);

    expect(pick("worktree")).toEqual(["m"]);
    expect(pick("project")).toEqual(["m", "r"]);
    expect(pick("all")).toEqual(["m", "r", "o"]);
  });

  it("matches on the spelling the renderer used, not the core's canonical path", () => {
    const aliased = row({ displayRoot: "/w/deck", workspacePath: "/private/w/deck" });
    expect(inScope(aliased, "worktree", subject, scans)).toBe(true);
  });

  it("keeps a sibling folder that shares a prefix out of the checkout", () => {
    const sibling = row({ displayRoot: "/w/deck-extra" });
    expect(inScope(sibling, "worktree", subject, scans)).toBe(false);
  });

  it("attributes a worktree nested in the checkout to itself, not to its parent", () => {
    const nested = "/w/deck/.claude/worktrees/x";
    const scan: RepositoryScan = {
      kind: "repository",
      key: "/w/deck/.git",
      root: "/w/deck",
      worktrees: [worktree("/w/deck", "main"), worktree(nested, "x")],
    };
    const nestedScans = new Map<string, RepositoryScan>([["/w/deck", scan]]);
    const nestedSubject = subjectFor("/w/deck", nestedScans);
    // The core labels a server with the deepest registered root holding its cwd.
    const cwd = `${nested}/web`;
    const displayRoot = devServerRoots(["/w/deck"], [], nestedScans)
      .filter((root) => cwd === root || cwd.startsWith(`${root}/`))
      .sort((a, b) => b.length - a.length)[0];
    const server = row({ displayRoot });

    expect(displayRoot).toBe(nested);

    expect(inScope(server, "worktree", nestedSubject, nestedScans)).toBe(false);
    expect(inScope(server, "project", nestedSubject, nestedScans)).toBe(true);
    expect(inScope(server, "all", nestedSubject, nestedScans)).toBe(true);
  });

  it("without a scan, includes a registered package root below the folder in project scope", () => {
    const plain = subjectFor("/proj", new Map());
    const web = row({ displayRoot: "/proj/apps/web" });
    const sibling = row({ displayRoot: "/proj-extra" });

    expect(inScope(web, "project", plain, new Map())).toBe(true);
    expect(inScope(web, "worktree", plain, new Map())).toBe(true);
    expect(inScope(sibling, "project", plain, new Map())).toBe(false);
  });

  it("includes a package root below the checkout", () => {
    const pkg = row({ displayRoot: "/w/deck/packages/web" });
    expect(inScope(pkg, "worktree", subject, scans)).toBe(true);
  });
});
