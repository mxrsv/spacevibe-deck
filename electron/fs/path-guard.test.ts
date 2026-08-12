import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertInsideRoot,
  assertWritableInsideRoot,
  isInside,
  PathOutsideWorkspaceError,
  resolveInsideRoot,
  resolveRoot,
} from "./path-guard";

/**
 * Driven over a REAL temp tree with REAL symlinks. The guard's whole job is to
 * survive `realpath`, and a fake filesystem would only ever re-assert the
 * arrangement the test itself invented.
 */
let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "deck-path-guard-"));
  root = path.join(base, "workspace");
  outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export {};\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "no\n");
  // A directory symlink pointing OUT of the root.
  fs.symlinkSync(outside, path.join(root, "away"));
  // A symlink pointing back IN — legal, and the case a naive textual check
  // would wrongly reject.
  fs.symlinkSync(path.join(root, "src"), path.join(root, "src-link"));
  // A sibling whose name merely starts with the root's — the case `startsWith`
  // would accept.
  fs.mkdirSync(`${root}-backup`, { recursive: true });
  fs.writeFileSync(path.join(`${root}-backup`, "a.ts"), "\n");
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("isInside", () => {
  it("accepts the root itself and anything under it", () => {
    expect(isInside("/r", "/r")).toBe(true);
    expect(isInside("/r", "/r/a/b.ts")).toBe(true);
  });

  it("rejects a sibling whose name merely starts with the root's", () => {
    expect(isInside("/r", "/r-backup/a.ts")).toBe(false);
  });

  it("rejects a parent", () => {
    expect(isInside("/r/a", "/r")).toBe(false);
  });
});

describe("resolveRoot", () => {
  it("canonicalizes a real directory", () => {
    expect(resolveRoot(root)).toBe(fs.realpathSync(root));
  });

  it("refuses a relative root, an empty one and a network root", () => {
    expect(resolveRoot("relative/path")).toBeNull();
    expect(resolveRoot("")).toBeNull();
    expect(resolveRoot("\\\\host\\share")).toBeNull();
    expect(resolveRoot("//host/share")).toBeNull();
  });

  it("refuses a root that does not exist", () => {
    expect(resolveRoot(path.join(base, "missing"))).toBeNull();
  });
});

describe("resolveInsideRoot", () => {
  const cases: [string, () => string | null, boolean][] = [
    [
      "an ordinary file under the root",
      () => resolveInsideRoot(root, path.join(root, "src", "index.ts")),
      true,
    ],
    [
      "a `..` traversal out of the root",
      () => resolveInsideRoot(root, path.join(root, "..", "outside", "secret.txt")),
      false,
    ],
    [
      "an absolute path outside the root",
      () => resolveInsideRoot(root, path.join(outside, "secret.txt")),
      false,
    ],
    [
      "a symlinked directory pointing out of the root",
      () => resolveInsideRoot(root, path.join(root, "away", "secret.txt")),
      false,
    ],
    [
      "the out-of-root symlink itself",
      () => resolveInsideRoot(root, path.join(root, "away")),
      false,
    ],
    [
      "a symlink pointing back into the root",
      () => resolveInsideRoot(root, path.join(root, "src-link", "index.ts")),
      true,
    ],
    [
      "a sibling directory whose name starts with the root's",
      () => resolveInsideRoot(root, path.join(`${root}-backup`, "a.ts")),
      false,
    ],
  ];

  for (const [name, run, allowed] of cases) {
    it(`${allowed ? "allows" : "refuses"} ${name}`, () => {
      expect(run() === null).toBe(!allowed);
    });
  }

  it("resolves a relative path against the root", () => {
    expect(resolveInsideRoot(root, "src/index.ts")).toBe(
      fs.realpathSync(path.join(root, "src", "index.ts")),
    );
  });

  it("works when the ROOT is itself a symlink", () => {
    // `/tmp` is a symlink on macOS, so comparing a resolved candidate against
    // an unresolved root would reject every path in a workspace opened there.
    const linkedRoot = path.join(base, "linked-root");
    fs.symlinkSync(root, linkedRoot);
    expect(
      resolveInsideRoot(linkedRoot, path.join(linkedRoot, "src", "index.ts")),
    ).toBe(fs.realpathSync(path.join(root, "src", "index.ts")));
    fs.unlinkSync(linkedRoot);
  });

  it("refuses a path that does not exist, a NUL byte and a network root", () => {
    expect(resolveInsideRoot(root, path.join(root, "missing.ts"))).toBeNull();
    expect(resolveInsideRoot(root, `${root}/a\0b`)).toBeNull();
    expect(resolveInsideRoot(root, "//host/share/a.ts")).toBeNull();
  });
});

describe("assertInsideRoot", () => {
  it("returns the canonical path or throws a named error", () => {
    expect(assertInsideRoot(root, path.join(root, "src", "index.ts"))).toContain(
      "index.ts",
    );
    expect(() => assertInsideRoot(root, path.join(outside, "secret.txt"))).toThrow(
      PathOutsideWorkspaceError,
    );
  });
});

describe("assertWritableInsideRoot", () => {
  it("allows a file that does not exist yet inside the root", () => {
    // The spec's dirty+deleted row offers "Save again", and that file does not
    // exist at the moment the user clicks it.
    const target = path.join(root, "src", "new-file.ts");
    expect(assertWritableInsideRoot(root, target)).toBe(
      path.join(fs.realpathSync(path.join(root, "src")), "new-file.ts"),
    );
  });

  it("refuses a new file whose parent is outside the root", () => {
    expect(() =>
      assertWritableInsideRoot(root, path.join(outside, "new.txt")),
    ).toThrow(PathOutsideWorkspaceError);
    expect(() =>
      assertWritableInsideRoot(root, path.join(root, "away", "new.txt")),
    ).toThrow(PathOutsideWorkspaceError);
  });

  it("refuses an EXISTING symlink that points out, instead of treating it as new", () => {
    // The escape this branch used to have: the link's parent is inside the
    // root, so the write was allowed and `writeFile` followed the link out.
    const escape = path.join(root, "escape.txt");
    fs.symlinkSync(path.join(outside, "secret.txt"), escape);
    try {
      expect(() => assertWritableInsideRoot(root, escape)).toThrow(
        PathOutsideWorkspaceError,
      );
    } finally {
      fs.unlinkSync(escape);
    }
  });

  it("refuses a DANGLING symlink that points out", () => {
    const dangling = path.join(root, "dangling.txt");
    fs.symlinkSync(path.join(outside, "never-existed.txt"), dangling);
    try {
      expect(() => assertWritableInsideRoot(root, dangling)).toThrow(
        PathOutsideWorkspaceError,
      );
    } finally {
      fs.unlinkSync(dangling);
    }
  });

  it("refuses a relative target", () => {
    expect(() => assertWritableInsideRoot(root, "src/new.ts")).toThrow(
      PathOutsideWorkspaceError,
    );
  });
});
