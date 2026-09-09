import { describe, expect, it } from "vitest";
import { subjectOf, subjectWhere, type MenuSubject } from "./agent-rail-card-model";
import { subjectForWorkspace, type RailWorktreeGroup } from "./agent-rail-model";
import type { RepositoryScan } from "../repositories/repository-client";

/**
 * The actions menu's subject (`openspec/changes/rail-create-consolidation`,
 * design D2): the same value whether a card derives it from its group or `⌘T`
 * derives it from a workspace path and the rail's scans, so the two
 * placements can never name one checkout two ways.
 */

function group(overrides: Partial<RailWorktreeGroup> = {}): RailWorktreeGroup {
  return {
    key: "/r/main",
    branch: "main",
    name: "spacevibe-board",
    path: "/r/main",
    repositoryPath: "/r/main",
    primary: true,
    labelled: true,
    entries: [],
    panes: [],
    live: false,
    age: "",
    active: false,
    rows: [],
    ...overrides,
  };
}

const SCAN: RepositoryScan = {
  kind: "repository",
  key: "/r/.git",
  root: "/r/spacevibe-board",
  worktrees: [
    {
      path: "/r/spacevibe-board",
      head: "a",
      branch: "main",
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    },
    {
      path: "/r/fix-login",
      head: "b",
      branch: "feat/fix-login",
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    },
  ],
};

describe("subjectOf", () => {
  it("names a primary checkout by its branch and keeps its branch", () => {
    const subject = subjectOf("spacevibe-board", group());
    expect(subject).toEqual<MenuSubject>({
      project: "spacevibe-board",
      path: "/r/main",
      repositoryPath: "/r/main",
      branch: "main",
      label: "main",
      labelled: true,
    });
  });

  it("names a linked worktree by its folder", () => {
    const subject = subjectOf(
      "spacevibe-board",
      group({
        key: "/r/wt",
        path: "/r/wt",
        name: "wt",
        branch: "feat/x",
        primary: false,
        repositoryPath: "/r/main",
      }),
    );
    expect(subject.label).toBe("wt");
    expect(subject.branch).toBe("feat/x");
    expect(subject.repositoryPath).toBe("/r/main");
  });

  it("answers no branch for a folder git does not know", () => {
    // `buildAgentRail` gives a plain folder one synthetic worktree whose
    // `branch` is the folder's own basename — a fallback, not a fact — so the
    // subject drops it rather than promising a branch to fork from.
    const subject = subjectOf("notes", group({ labelled: false, branch: "notes", name: "notes" }));
    expect(subject.branch).toBeNull();
    expect(subject.labelled).toBe(false);
    expect(subject.label).toBe("notes");
  });
});

describe("subjectWhere", () => {
  it("states the project once and the branch once for a primary checkout", () => {
    expect(subjectWhere(subjectOf("spacevibe-board", group()))).toBe("spacevibe-board · main");
  });

  it("states a worktree named after its branch exactly once", () => {
    const subject = subjectOf(
      "main",
      group({ path: "/r/side", name: "side", branch: "side", primary: false }),
    );
    expect(subjectWhere(subject)).toBe("main · side");
  });

  it("states only the project for a plain folder", () => {
    expect(
      subjectWhere(subjectOf("notes", group({ labelled: false, branch: "notes", name: "notes" }))),
    ).toBe("notes");
  });
});

describe("subjectForWorkspace", () => {
  const scans = new Map<string, RepositoryScan>([
    ["/r/spacevibe-board", SCAN],
    ["/r/fix-login", SCAN],
    ["/r/spacevibe-board/packages/ui", SCAN],
  ]);

  it("answers the repository's primary checkout, by its branch", () => {
    expect(subjectForWorkspace("/r/spacevibe-board", scans)).toEqual<MenuSubject>({
      project: "spacevibe-board",
      path: "/r/spacevibe-board",
      repositoryPath: "/r/spacevibe-board",
      branch: "main",
      label: "main",
      labelled: true,
    });
  });

  it("answers a linked worktree by its folder, with its own branch and the repository", () => {
    expect(subjectForWorkspace("/r/fix-login", scans)).toEqual<MenuSubject>({
      project: "spacevibe-board",
      path: "/r/fix-login",
      repositoryPath: "/r/spacevibe-board",
      branch: "feat/fix-login",
      label: "fix-login",
      labelled: true,
    });
  });

  it("lands a tab opened below the root on its worktree root, never its cwd", () => {
    const subject = subjectForWorkspace("/r/spacevibe-board/packages/ui", scans);
    expect(subject.path).toBe("/r/spacevibe-board");
    expect(subject.label).toBe("main");
  });

  it("answers an unscanned folder as unlabelled with the folder's name", () => {
    expect(subjectForWorkspace("/w/notes", scans)).toEqual<MenuSubject>({
      project: "notes",
      path: "/w/notes",
      repositoryPath: "/w/notes",
      branch: null,
      label: "notes",
      labelled: false,
    });
  });

  it("answers a plain scan the same way", () => {
    const plain = new Map<string, RepositoryScan>([
      ["/w/notes", { kind: "plain", reason: "not a git repository" }],
    ]);
    expect(subjectForWorkspace("/w/notes", plain).labelled).toBe(false);
  });

  it("agrees with subjectOf about the same checkout", () => {
    // The two placements build the subject from different inputs; the words
    // must come out identical or `⌘T` and the card would name one checkout
    // two ways.
    const fromCard = subjectOf(
      "spacevibe-board",
      group({
        key: "/r/fix-login",
        path: "/r/fix-login",
        name: "fix-login",
        branch: "feat/fix-login",
        primary: false,
        repositoryPath: "/r/spacevibe-board",
      }),
    );
    expect(subjectForWorkspace("/r/fix-login", scans)).toEqual(fromCard);
  });
});
