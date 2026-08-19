import { describe, expect, it } from "vitest";
import type { RepositoryScan, WorktreeEntry } from "./repository-client";
import {
  defaultDestinationPath,
  destinationLabel,
  worktreeDestinations,
} from "./worktree-destinations";

function entry(over: Partial<WorktreeEntry> & { path: string }): WorktreeEntry {
  return {
    head: "abc1234",
    branch: "main",
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
    ...over,
  };
}

function repo(worktrees: readonly WorktreeEntry[]): RepositoryScan {
  return {
    kind: "repository",
    key: "/repo/.git",
    root: "/repo",
    worktrees,
  };
}

describe("worktreeDestinations", () => {
  it("maps each worktree to a folder name and its branch, in git's order", () => {
    const destinations = worktreeDestinations(
      repo([
        entry({ path: "/dev/deck", branch: "main" }),
        entry({ path: "/dev/deck-modal", branch: "feat/modal-shell" }),
      ]),
    );

    expect(destinations).toEqual([
      { path: "/dev/deck", name: "deck", branch: "main", primary: true },
      {
        path: "/dev/deck-modal",
        name: "deck-modal",
        branch: "feat/modal-shell",
        primary: false,
      },
    ]);
  });

  it("is empty for a folder that is not a repository", () => {
    expect(worktreeDestinations({ kind: "plain", reason: "not a repository" })).toEqual([]);
  });

  // A host with no `git_repository` channel never writes a scan, so the
  // caller reads undefined and must land on "no destination row".
  it("is empty when there is no scan at all", () => {
    expect(worktreeDestinations(undefined)).toEqual([]);
    expect(worktreeDestinations(null)).toEqual([]);
  });

  it("drops a bare entry — it has no working directory to open in", () => {
    const destinations = worktreeDestinations(
      repo([
        entry({ path: "/dev/deck.git", bare: true, branch: null }),
        entry({ path: "/dev/deck", branch: "main" }),
      ]),
    );

    expect(destinations.map((d) => d.path)).toEqual(["/dev/deck"]);
  });

  it("drops a prunable entry — git says its directory is gone", () => {
    const destinations = worktreeDestinations(
      repo([
        entry({ path: "/dev/deck", branch: "main" }),
        entry({
          path: "/dev/gone",
          prunable: "gitdir file points to non-existent location",
        }),
      ]),
    );

    expect(destinations.map((d) => d.path)).toEqual(["/dev/deck"]);
  });

  // `primary` must mean the same thing here as on a rail row, so it is
  // computed before prunable entries leave — otherwise a prunable main
  // checkout would promote its sibling and the two surfaces would disagree.
  it("keeps primary on git's first non-bare entry even when it is pruned away", () => {
    const destinations = worktreeDestinations(
      repo([
        entry({ path: "/dev/gone", prunable: "missing" }),
        entry({ path: "/dev/deck-modal", branch: "feat/x" }),
      ]),
    );

    expect(destinations).toEqual([
      {
        path: "/dev/deck-modal",
        name: "deck-modal",
        branch: "feat/x",
        primary: false,
      },
    ]);
  });

  it("carries a detached worktree with a null branch rather than dropping it", () => {
    const destinations = worktreeDestinations(
      repo([entry({ path: "/dev/deck", branch: null, detached: true })]),
    );

    expect(destinations[0].branch).toBeNull();
  });
});

describe("destinationLabel", () => {
  it("prints folder and branch", () => {
    expect(
      destinationLabel({
        path: "/dev/deck",
        name: "deck",
        branch: "main",
        primary: true,
      }),
    ).toBe("deck · main");
  });

  it("prints the folder alone when there is no branch", () => {
    expect(
      destinationLabel({
        path: "/dev/deck",
        name: "deck",
        branch: null,
        primary: true,
      }),
    ).toBe("deck");
  });
});

describe("defaultDestinationPath", () => {
  const destinations = worktreeDestinations(
    repo([
      entry({ path: "/dev/deck", branch: "main" }),
      entry({ path: "/dev/deck-modal", branch: "feat/modal-shell" }),
    ]),
  );

  it("prefers the worktree owning the focused pane's cwd", () => {
    expect(defaultDestinationPath(destinations, "/dev/deck-modal", "/dev/deck")).toBe(
      "/dev/deck-modal",
    );
  });

  it("resolves a cwd BELOW a worktree to that worktree", () => {
    expect(defaultDestinationPath(destinations, "/dev/deck-modal/src/ui", null)).toBe(
      "/dev/deck-modal",
    );
  });

  it("falls back to the next candidate when the first matches nothing", () => {
    expect(defaultDestinationPath(destinations, "/tmp/scratch", "/dev/deck")).toBe("/dev/deck");
  });

  it("falls back to the repository's own checkout when nothing matches", () => {
    expect(defaultDestinationPath(destinations, null, null)).toBe("/dev/deck");
  });

  it("has no answer for an empty list", () => {
    expect(defaultDestinationPath([], "/dev/deck")).toBeNull();
  });
});
