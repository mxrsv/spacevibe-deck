import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_ROOTS,
  canonicalizeRoots,
  deepestRoot,
  isWithinRoot,
  type CanonicalRoot,
} from "./roots";

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-roots-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const root = (canonical: string): CanonicalRoot => ({ input: canonical, canonical });

describe("isWithinRoot", () => {
  it("matches whole path segments only", () => {
    expect(isWithinRoot("/p", "/p")).toBe(true);
    expect(isWithinRoot("/p", "/p/packages/web")).toBe(true);
    expect(isWithinRoot("/p", "/p-other")).toBe(false);
    expect(isWithinRoot("/p", "/p-other/web")).toBe(false);
    expect(isWithinRoot("/p/a", "/p")).toBe(false);
  });

  it("treats the filesystem root as holding everything", () => {
    expect(isWithinRoot("/", "/anything/at/all")).toBe(true);
  });
});

describe("deepestRoot", () => {
  it("prefers the most specific root and ignores sibling prefixes", () => {
    const roots = [root("/p"), root("/p/packages/web"), root("/p-other")];
    expect(deepestRoot(roots, "/p/packages/web/src")?.canonical).toBe("/p/packages/web");
    expect(deepestRoot(roots, "/p/packages")?.canonical).toBe("/p");
    expect(deepestRoot(roots, "/p-other/x")?.canonical).toBe("/p-other");
    expect(deepestRoot(roots, "/elsewhere")).toBeNull();
  });

  it("does not depend on the order of the roots", () => {
    const roots = [root("/p/packages/web"), root("/p")];
    expect(deepestRoot(roots, "/p/packages/web")?.canonical).toBe("/p/packages/web");
  });
});

describe("canonicalizeRoots", () => {
  it("resolves a symlinked root and keeps the caller's spelling", async () => {
    // os.tmpdir() is /var/folders/... on macOS, and /var is a symlink to /private/var.
    const real = fs.realpathSync(tempDir());
    const link = path.join(tempDir(), "link");
    fs.symlinkSync(real, link);
    const { roots, diagnostics } = await canonicalizeRoots([link]);
    expect(diagnostics).toEqual([]);
    expect(roots).toEqual([{ input: link, canonical: real }]);
  });

  it("resolves the tmpdir symlink so lsof's canonical cwd matches", async () => {
    const dir = tempDir();
    const { roots } = await canonicalizeRoots([dir]);
    expect(roots[0]?.canonical).toBe(fs.realpathSync.native(dir));
    const cwd = path.join(fs.realpathSync.native(dir), "packages", "web");
    expect(deepestRoot(roots, cwd)?.input).toBe(dir);
  });

  it("collapses two spellings of one directory to the first", async () => {
    const real = fs.realpathSync(tempDir());
    const link = path.join(tempDir(), "link");
    fs.symlinkSync(real, link);
    const { roots } = await canonicalizeRoots([link, real]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.input).toBe(link);
  });

  it("reports missing directories instead of silently dropping them", async () => {
    const missing = path.join(tempDir(), "gone");
    const { roots, diagnostics } = await canonicalizeRoots([missing]);
    expect(roots).toEqual([]);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "not-found", root: missing })]);
  });

  it("classifies other filesystem errors as unreadable", async () => {
    const denied = async (): Promise<string> => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    const { diagnostics } = await canonicalizeRoots(["/private/x"], denied);
    expect(diagnostics[0]?.code).toBe("unreadable");
  });

  it("rejects non-array input, non-strings, NUL, relative and over-long roots", async () => {
    expect((await canonicalizeRoots("nope")).diagnostics[0]?.code).toBe("invalid");
    const bad = [42, "", "relative/path", "/a\0b", "/" + "x".repeat(5000)];
    const { roots, diagnostics } = await canonicalizeRoots(bad, async (p) => p);
    expect(roots).toEqual([]);
    expect(diagnostics).toHaveLength(bad.length);
    expect(diagnostics.every((entry) => entry.code === "invalid")).toBe(true);
    expect(diagnostics.every((entry) => entry.root.length <= 120)).toBe(true);
  });

  it("caps the list at MAX_ROOTS and says so", async () => {
    const inputs = Array.from({ length: MAX_ROOTS + 5 }, (_, index) => `/r${index}`);
    const { roots, diagnostics } = await canonicalizeRoots(inputs, async (p) => p);
    expect(roots).toHaveLength(MAX_ROOTS);
    expect(diagnostics.map((entry) => entry.code)).toEqual(["over-limit"]);
  });
});
