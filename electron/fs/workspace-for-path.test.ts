import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspaceForPath } from "./workspace-for-path";

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-wsfp-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("workspaceForPath", () => {
  it("answers the root that holds the file", () => {
    const root = tempDir();
    const file = path.join(fs.realpathSync(root), "foo.ts");
    fs.writeFileSync(file, "");
    expect(workspaceForPath({ path: file, roots: [root] })).toBe(root);
  });

  it("answers the root as the RENDERER spelled it, not its realpath", () => {
    // `/tmp` is a symlink on macOS, so `root` and `realpathSync(root)` differ
    // here — and every file-surface lookup is keyed by the renderer's string.
    const root = tempDir();
    const canonical = fs.realpathSync(root);
    const file = path.join(canonical, "foo.ts");
    fs.writeFileSync(file, "");
    const answer = workspaceForPath({ path: file, roots: [root] });
    expect(answer).toBe(root);
    if (canonical !== root) {
      expect(answer).not.toBe(canonical);
    }
  });

  it("answers null for a path no open root holds", () => {
    const root = tempDir();
    const other = tempDir();
    const file = path.join(fs.realpathSync(other), "foo.ts");
    fs.writeFileSync(file, "");
    expect(workspaceForPath({ path: file, roots: [root] })).toBeNull();
  });

  it("prefers the first root — the list is ordered by relevance", () => {
    const outer = fs.realpathSync(tempDir());
    const inner = path.join(outer, "nested");
    fs.mkdirSync(inner);
    const file = path.join(inner, "foo.ts");
    fs.writeFileSync(file, "");
    expect(workspaceForPath({ path: file, roots: [inner, outer] })).toBe(inner);
    expect(workspaceForPath({ path: file, roots: [outer, inner] })).toBe(outer);
  });

  it("refuses a path that escapes its root through a symlink", () => {
    const root = fs.realpathSync(tempDir());
    const outside = fs.realpathSync(tempDir());
    const secret = path.join(outside, "secret.ts");
    fs.writeFileSync(secret, "");
    const link = path.join(root, "link.ts");
    fs.symlinkSync(secret, link);
    // The guard resolves BOTH sides, so the link's target decides.
    expect(workspaceForPath({ path: link, roots: [root] })).toBeNull();
  });

  it("survives a nonsense request", () => {
    expect(workspaceForPath({ path: "", roots: ["/repo"] })).toBeNull();
    expect(
      workspaceForPath({
        path: "/repo/foo.ts",
        roots: [null as unknown as string],
      }),
    ).toBeNull();
  });
});
