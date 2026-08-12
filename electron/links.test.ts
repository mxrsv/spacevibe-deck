/** Translated from the resolve/validate tests in `src-tauri/src/links.rs`. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOne, resolvePaths, validateOpenEditorRequest } from "./links";

const temps: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "deck-links-")));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveOne", () => {
  it("resolves a relative path against the pane cwd", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "main.ts"), "x");

    expect(resolveOne(dir, "/home", "main.ts")).toBe(join(dir, "main.ts"));
  });

  it("refuses a relative path when the cwd is unknown", () => {
    // Guessing a base would let `src/main.ts` printed by an agent in
    // ~/work/api resolve to an unrelated ~/src/main.ts that happens to exist,
    // and a click would open the wrong file with the hover text looking right.
    expect(resolveOne(null, "/home", "src/main.ts")).toBe(null);
  });

  it("resolves an absolute path with no cwd", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "x");

    expect(resolveOne(null, "/home", join(dir, "a.txt"))).toBe(join(dir, "a.txt"));
  });

  it("expands a tilde against home", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "x");

    expect(resolveOne(null, dir, "~/a.txt")).toBe(join(dir, "a.txt"));
  });

  it("does not linkify a directory", () => {
    // There is no line to jump to, and `code -g <dir>:1:1` is meaningless.
    const dir = tempDir();
    mkdirSync(join(dir, "sub"));

    expect(resolveOne(dir, "/home", "sub")).toBe(null);
  });

  it("refuses a network root before touching the filesystem", () => {
    expect(resolveOne(null, "/home", String.raw`\\host\share\file.txt`)).toBe(null);
  });

  it("returns null for a missing file", () => {
    expect(resolveOne(tempDir(), "/home", "nope.txt")).toBe(null);
  });
});

describe("resolvePaths", () => {
  it("is index-aligned with its input", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "x");

    expect(resolvePaths(dir, ["a.txt", "missing.txt", "a.txt"])).toEqual([
      join(dir, "a.txt"),
      null,
      join(dir, "a.txt"),
    ]);
  });

  it("caps the batch so a garbled line stays cheap", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "x");
    const many = Array.from({ length: 70 }, () => "a.txt");

    const resolved = resolvePaths(dir, many);

    expect(resolved.slice(0, 64).every((entry) => entry !== null)).toBe(true);
    expect(resolved.slice(64).every((entry) => entry === null)).toBe(true);
  });

  it("resolves only absolute candidates when the cwd is empty", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "x");

    expect(resolvePaths("", ["a.txt", join(dir, "a.txt")])).toEqual([
      null,
      join(dir, "a.txt"),
    ]);
  });
});

describe("validateOpenEditorRequest", () => {
  function request(overrides: Record<string, unknown> = {}) {
    const dir = tempDir();
    const file = join(dir, "a.ts");
    writeFileSync(file, "x");
    return {
      editor: "vscode",
      template: "",
      file,
      line: 1,
      column: 1,
      ...overrides,
    };
  }

  it("accepts a canonical absolute file", () => {
    expect(() => validateOpenEditorRequest(request())).not.toThrow();
  });

  it("rejects an unsupported editor", () => {
    expect(() => validateOpenEditorRequest(request({ editor: "vim" }))).toThrow(
      /not supported/,
    );
  });

  it("rejects a relative path", () => {
    expect(() => validateOpenEditorRequest(request({ file: "a.ts" }))).toThrow(
      /must be absolute/,
    );
  });

  it("rejects a network path", () => {
    expect(() =>
      validateOpenEditorRequest(request({ file: String.raw`\\host\share\a.ts` })),
    ).toThrow(/network location/);
  });

  it("rejects a non-positive line or column", () => {
    expect(() => validateOpenEditorRequest(request({ line: 0 }))).toThrow(/line/);
    expect(() => validateOpenEditorRequest(request({ column: -1 }))).toThrow(/column/);
  });

  it("rejects a custom editor whose executable is a placeholder", () => {
    // The executable must be fixed: a placeholder there would let terminal
    // output choose which program runs.
    expect(() =>
      validateOpenEditorRequest(
        request({ editor: "custom", template: "{file} --open" }),
      ),
    ).toThrow(/must be a fixed command/);
  });

  it("rejects a custom editor with no template", () => {
    expect(() =>
      validateOpenEditorRequest(request({ editor: "custom", template: "  " })),
    ).toThrow(/No custom editor command/);
  });

  it("rejects a NUL byte in the path", () => {
    expect(() =>
      validateOpenEditorRequest(request({ file: "/tmp/a\0b.ts" })),
    ).toThrow(/invalid or too long/);
  });

  it("rejects a file that does not exist", () => {
    expect(() =>
      validateOpenEditorRequest(request({ file: "/tmp/deck-definitely-missing.ts" })),
    ).toThrow(/does not exist/);
  });

  it("rejects a directory target", () => {
    expect(() => validateOpenEditorRequest(request({ file: tempDir() }))).toThrow(
      /must be a file/,
    );
  });
});
