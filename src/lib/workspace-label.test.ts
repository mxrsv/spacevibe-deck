import { describe, expect, it } from "vitest";
import { normalizeWorkspacePath, workspaceLabel } from "./workspace-label";

describe("normalizeWorkspacePath", () => {
  it("gives one spelling to paths that differ only by a trailing slash", () => {
    expect(normalizeWorkspacePath("/Users/k/dev/x")).toBe("/Users/k/dev/x");
    expect(normalizeWorkspacePath("/Users/k/dev/x/")).toBe("/Users/k/dev/x");
    expect(normalizeWorkspacePath("  /Users/k/dev/x//  ")).toBe("/Users/k/dev/x");
  });

  it("keeps the root and rejects an empty path", () => {
    expect(normalizeWorkspacePath("/")).toBe("/");
    expect(normalizeWorkspacePath("")).toBeNull();
    expect(normalizeWorkspacePath("   ")).toBeNull();
  });
});

describe("workspaceLabel", () => {
  it("returns the basename of a workspace path", () => {
    expect(workspaceLabel("/Users/k/dev/stackgrid")).toBe("stackgrid");
  });

  it("ignores a trailing slash", () => {
    expect(workspaceLabel("/Users/k/dev/stackgrid/")).toBe("stackgrid");
    expect(workspaceLabel("/Users/k/dev/stackgrid///")).toBe("stackgrid");
  });

  it("keeps the root as-is", () => {
    expect(workspaceLabel("/")).toBe("/");
    expect(workspaceLabel("///")).toBe("/");
  });

  it("falls back to Unknown on an empty path", () => {
    expect(workspaceLabel("")).toBe("Unknown");
    expect(workspaceLabel("   ")).toBe("Unknown");
  });

  // Pinned before the Windows support landed: a path without a backslash must
  // keep its exact output, so the macOS picture cannot move.
  it("keeps every backslash-free spelling exactly as before", () => {
    expect(workspaceLabel("  /a/b  ")).toBe("b");
    expect(workspaceLabel("/a b/c d/")).toBe("c d");
    expect(workspaceLabel("//")).toBe("/");
    expect(workspaceLabel("/a//b")).toBe("b");
    expect(workspaceLabel("deck")).toBe("deck");
    expect(workspaceLabel("a/b")).toBe("b");
    expect(workspaceLabel(".")).toBe(".");
  });

  // A backslash is a legal filename character on macOS and Linux, so a path
  // that does not look like a Windows one must never be cut at it.
  it("keeps a literal backslash in a POSIX folder name", () => {
    expect(workspaceLabel("/Users/me/a\\b")).toBe("a\\b");
    expect(workspaceLabel("/Users/me/proj\\")).toBe("proj\\");
    expect(workspaceLabel("/Users/me/a\\b/")).toBe("a\\b");
    expect(workspaceLabel("\\")).toBe("\\");
    expect(workspaceLabel("a\\b")).toBe("a\\b");
  });

  it("leaves a forward-slash drive spelling as it was", () => {
    expect(workspaceLabel("C:")).toBe("C:");
    expect(workspaceLabel("C:/")).toBe("C:");
    expect(workspaceLabel("C:/Users/me/code/deck")).toBe("deck");
    expect(workspaceLabel("/tmp/C:/")).toBe("C:");
  });

  it("names a Windows path by its last folder", () => {
    expect(workspaceLabel("C:\\Users\\me\\code\\deck")).toBe("deck");
    expect(workspaceLabel("C:\\Users\\me\\code\\deck\\")).toBe("deck");
    expect(workspaceLabel("C:\\Users\\me\\code\\deck\\\\")).toBe("deck");
    expect(workspaceLabel("  C:\\Users\\me\\code\\deck  ")).toBe("deck");
    expect(workspaceLabel("C:/Users\\me/code\\deck")).toBe("deck");
  });

  it("shows a Windows drive root as the root, not as a bare drive letter", () => {
    expect(workspaceLabel("C:\\")).toBe("C:\\");
    expect(workspaceLabel("d:\\\\")).toBe("d:\\");
  });

  it("names a UNC path by its last folder", () => {
    expect(workspaceLabel("\\\\server\\share\\deck")).toBe("deck");
    expect(workspaceLabel("\\\\server\\share\\deck\\")).toBe("deck");
    expect(workspaceLabel("\\\\server\\share")).toBe("share");
  });
});
