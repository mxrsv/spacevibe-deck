import { describe, expect, it } from "vitest";
import { deckScans, row } from "./dev-server-fixtures";
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
});

describe("subjectFor", () => {
  it("names the repository and the checkout's branch", () => {
    expect(subjectFor("/w/deck-redesign", scans)).toMatchObject({
      name: "deck",
      branch: "redesign",
      worktree: "/w/deck-redesign",
    });
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

  it("includes a package root below the checkout", () => {
    const pkg = row({ displayRoot: "/w/deck/packages/web" });
    expect(inScope(pkg, "worktree", subject, scans)).toBe(true);
  });
});
