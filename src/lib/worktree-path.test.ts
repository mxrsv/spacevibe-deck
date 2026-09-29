import { describe, expect, it } from "vitest";
import { suggestWorktreeDest } from "./worktree-path";

describe("suggestWorktreeDest", () => {
  it("suggests <repo parent>/<repo name>-worktrees/<branch>", () => {
    expect(suggestWorktreeDest("/Users/x/deck", "redesign")).toBe(
      "/Users/x/deck-worktrees/redesign",
    );
  });

  it("nests a slashed branch name rather than flattening it", () => {
    expect(suggestWorktreeDest("/Users/x/deck", "feature/x")).toBe(
      "/Users/x/deck-worktrees/feature/x",
    );
  });

  it("strips a trailing slash on the repo path before deriving the name", () => {
    expect(suggestWorktreeDest("/Users/x/deck/", "redesign")).toBe(
      "/Users/x/deck-worktrees/redesign",
    );
  });

  it("trims whitespace around the branch name", () => {
    expect(suggestWorktreeDest("/Users/x/deck", "  redesign  ")).toBe(
      "/Users/x/deck-worktrees/redesign",
    );
  });

  it("handles a repo directly under root", () => {
    expect(suggestWorktreeDest("/deck", "redesign")).toBe("/deck-worktrees/redesign");
  });

  it("returns empty when the repo path is empty", () => {
    expect(suggestWorktreeDest("", "redesign")).toBe("");
  });

  it("returns empty when the branch is empty or blank", () => {
    expect(suggestWorktreeDest("/Users/x/deck", "")).toBe("");
    expect(suggestWorktreeDest("/Users/x/deck", "   ")).toBe("");
  });

  // Pinned before the Windows support landed: a repo path without a backslash
  // must keep its exact output, so the macOS picture cannot move.
  it("keeps every backslash-free spelling exactly as before", () => {
    // Only ONE trailing slash is stripped, so a doubled one leaves no name.
    expect(suggestWorktreeDest("/Users/x/deck//", "b")).toBe("");
    expect(suggestWorktreeDest("/", "x")).toBe("");
    expect(suggestWorktreeDest("//", "x")).toBe("");
    // No separator at all falls back to "/".
    expect(suggestWorktreeDest("deck", "x")).toBe("/deck-worktrees/x");
    expect(suggestWorktreeDest("a/b", "x")).toBe("a/b-worktrees/x");
    expect(suggestWorktreeDest("/a b/deck", "x")).toBe("/a b/deck-worktrees/x");
    expect(suggestWorktreeDest("  /a/b", "x")).toBe("  /a/b-worktrees/x");
    expect(suggestWorktreeDest("C:/code/deck", "feat/x")).toBe("C:/code/deck-worktrees/feat/x");
  });

  it("keeps a Windows repo path's own separator", () => {
    expect(suggestWorktreeDest("C:\\code\\deck", "feat/x")).toBe(
      "C:\\code\\deck-worktrees\\feat/x",
    );
    expect(suggestWorktreeDest("C:\\code\\deck", "redesign")).toBe(
      "C:\\code\\deck-worktrees\\redesign",
    );
  });

  it("strips one trailing backslash before deriving the name", () => {
    expect(suggestWorktreeDest("C:\\code\\deck\\", "redesign")).toBe(
      "C:\\code\\deck-worktrees\\redesign",
    );
  });

  it("handles a Windows repo directly under the drive root or a UNC share", () => {
    expect(suggestWorktreeDest("C:\\deck", "redesign")).toBe("C:\\deck-worktrees\\redesign");
    expect(suggestWorktreeDest("\\\\server\\share\\deck", "redesign")).toBe(
      "\\\\server\\share\\deck-worktrees\\redesign",
    );
  });

  it("follows the separator next to the repo name when a path mixes both", () => {
    expect(suggestWorktreeDest("C:/code\\deck", "redesign")).toBe(
      "C:/code\\deck-worktrees\\redesign",
    );
    expect(suggestWorktreeDest("C:\\code/deck", "redesign")).toBe(
      "C:\\code/deck-worktrees/redesign",
    );
  });
});
