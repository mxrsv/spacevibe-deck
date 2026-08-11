import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PathOutsideWorkspaceError } from "./path-guard";
import { writeFileAtomically, writeTextFile } from "./write";

let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "deck-fs-write-"));
  root = path.join(base, "workspace");
  outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.txt"), "untouched\n");
  fs.symlinkSync(outside, path.join(root, "away"));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("writeFileAtomically", () => {
  it("writes through a temp file and leaves nothing behind", async () => {
    const target = path.join(root, "atomic.txt");
    await writeFileAtomically(target, "hello\n");
    expect(fs.readFileSync(target, "utf8")).toBe("hello\n");
    expect(
      fs.readdirSync(root).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("creates missing parent directories", async () => {
    const target = path.join(root, "made", "up", "file.txt");
    await writeFileAtomically(target, "x");
    expect(fs.readFileSync(target, "utf8")).toBe("x");
  });

  it("applies the mode it is given", async () => {
    const target = path.join(root, "moded.sh");
    await writeFileAtomically(target, "#!/bin/sh\n", { mode: 0o755 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o755);
  });
});

describe("writeTextFile", () => {
  it("saves and reports the new mtime and size", async () => {
    const target = path.join(root, "src", "index.ts");
    fs.writeFileSync(target, "old\n");
    const result = await writeTextFile(root, target, "new content\n", "lf");
    expect(fs.readFileSync(target, "utf8")).toBe("new content\n");
    expect(result.size).toBe("new content\n".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
  });

  it("preserves the file's CRLF ending on save", async () => {
    const target = path.join(root, "crlf.txt");
    fs.writeFileSync(target, "a\r\nb\r\n");
    await writeTextFile(root, target, "a\nb\nc\n", "crlf");
    expect(fs.readFileSync(target, "utf8")).toBe("a\r\nb\r\nc\r\n");
  });

  it("preserves the mode, so saving a script does not strip its +x", async () => {
    const target = path.join(root, "script.sh");
    fs.writeFileSync(target, "#!/bin/sh\necho old\n");
    fs.chmodSync(target, 0o755);
    await writeTextFile(root, target, "#!/bin/sh\necho new\n", "lf");
    expect(fs.statSync(target).mode & 0o777).toBe(0o755);
  });

  it("resolves symlinks and replaces the TARGET, not the link", async () => {
    const target = path.join(root, "src", "real.ts");
    const link = path.join(root, "src", "link.ts");
    fs.writeFileSync(target, "original\n");
    fs.symlinkSync(target, link);
    const result = await writeTextFile(root, link, "through the link\n", "lf");
    expect(result.path).toBe(fs.realpathSync(target));
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("through the link\n");
    fs.rmSync(link);
  });

  it("recreates a file the agent deleted — the 'Save again' branch", async () => {
    const target = path.join(root, "src", "deleted.ts");
    await writeTextFile(root, target, "back\n", "lf");
    expect(fs.readFileSync(target, "utf8")).toBe("back\n");
  });

  it("refuses to write outside the root, through a link or otherwise", async () => {
    await expect(
      writeTextFile(root, path.join(outside, "secret.txt"), "x", "lf"),
    ).rejects.toThrow(PathOutsideWorkspaceError);
    await expect(
      writeTextFile(root, path.join(root, "away", "new.txt"), "x", "lf"),
    ).rejects.toThrow(PathOutsideWorkspaceError);
    // An existing symlink whose target is outside: the guard resolves before
    // deciding, so this cannot be used to write out of the workspace.
    const escape = path.join(root, "escape.txt");
    fs.symlinkSync(path.join(outside, "secret.txt"), escape);
    await expect(writeTextFile(root, escape, "x", "lf")).rejects.toThrow(
      PathOutsideWorkspaceError,
    );
    expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).not.toBe(
      "x",
    );
    fs.rmSync(escape);
  });
});
