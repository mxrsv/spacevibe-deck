import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXTERNAL_APP_CATALOG, bundlePath, repositoryRoot, resolveTarget } from "./external-apps";
import { EXTERNAL_APPS } from "../src/lib/external-app-catalog";

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-extapps-"));
  temps.push(dir);
  // `realpath` because macOS hands out `/var` for `/private/var`, and every
  // assertion below compares against a path the code canonicalised.
  return fs.realpathSync(dir);
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("the two catalog halves", () => {
  it("declare the same apps, in the same order", () => {
    // Design §4.2: the renderer prints the list and main launches it. Two
    // tables that drift put a row in the menu that nothing can open.
    expect(EXTERNAL_APP_CATALOG.map((entry) => entry.id)).toEqual(
      EXTERNAL_APPS.map((app) => app.id),
    );
  });

  it("declare the same label, group and open rules per app", () => {
    for (const entry of EXTERNAL_APP_CATALOG) {
      const mirrored = EXTERNAL_APPS.find((app) => app.id === entry.id);
      expect(mirrored, entry.id).toBeDefined();
      expect(
        {
          label: entry.label,
          group: entry.group,
          opensFile: entry.opensFile,
          opensFolder: entry.opensFolder,
        },
        entry.id,
      ).toEqual({
        label: mirrored!.label,
        group: mirrored!.group,
        opensFile: mirrored!.opensFile,
        opensFolder: mirrored!.opensFolder,
      });
    }
  });

  it("gives every app at least one bundle to look for", () => {
    for (const entry of EXTERNAL_APP_CATALOG) {
      expect(entry.bundles.length, entry.id).toBeGreaterThan(0);
    }
  });
});

describe("bundlePath", () => {
  it("finds a bundle that exists", () => {
    const home = tempDir();
    fs.mkdirSync(path.join(home, "Applications", "Fake.app"), {
      recursive: true,
    });
    const found = bundlePath(
      {
        id: "fake",
        label: "Fake",
        group: "editor",
        bundles: ["/nowhere/Fake.app", "~/Applications/Fake.app"],
        opensFile: "as-is",
        opensFolder: "as-is",
      },
      home,
    );
    expect(found).toBe(path.join(home, "Applications", "Fake.app"));
  });

  it("answers null when no spelling exists", () => {
    expect(
      bundlePath(
        {
          id: "fake",
          label: "Fake",
          group: "editor",
          bundles: ["/nowhere/Fake.app"],
          opensFile: "as-is",
          opensFolder: "as-is",
        },
        tempDir(),
      ),
    ).toBeNull();
  });
});

describe("repositoryRoot", () => {
  it("finds the root a nested directory belongs to", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
    expect(repositoryRoot(path.join(root, "src", "deep"))).toBe(root);
  });

  it("accepts a worktree's `.git` FILE, not only a directory", () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /elsewhere\n");
    expect(repositoryRoot(root)).toBe(root);
  });

  it("answers null outside every repository", () => {
    expect(repositoryRoot(tempDir())).toBeNull();
  });
});

describe("resolveTarget", () => {
  it("hands an editor the path itself", () => {
    expect(resolveTarget("as-is", "/repo/src/foo.ts", false)).toEqual({
      path: "/repo/src/foo.ts",
      reveal: false,
    });
  });

  it("reveals a file for Finder and opens a folder", () => {
    expect(resolveTarget("reveal", "/repo/src/foo.ts", false)).toEqual({
      path: "/repo/src/foo.ts",
      reveal: true,
    });
    expect(resolveTarget("reveal", "/repo", true)).toEqual({
      path: "/repo",
      reveal: false,
    });
  });

  it("hands a terminal the containing directory of a file", () => {
    expect(resolveTarget("directory", "/repo/src/foo.ts", false)).toEqual({
      path: "/repo/src",
      reveal: false,
    });
  });

  it("hands a git client the repository root", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "src"));
    const file = path.join(root, "src", "foo.ts");
    fs.writeFileSync(file, "");
    expect(resolveTarget("repository", file, false)).toEqual({
      path: root,
      reveal: false,
    });
  });

  it("falls back to the folder itself when git does not know it", () => {
    const plain = tempDir();
    expect(resolveTarget("repository", plain, true)).toEqual({
      path: plain,
      reveal: false,
    });
  });

  it("says so for a file no repository holds", () => {
    const plain = tempDir();
    const file = path.join(plain, "foo.ts");
    fs.writeFileSync(file, "");
    expect(resolveTarget("repository", file, false)).toEqual({
      error: "That file is not inside a git repository.",
    });
  });
});
