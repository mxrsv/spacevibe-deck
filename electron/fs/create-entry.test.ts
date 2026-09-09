import { mkdtemp, mkdir, realpath, rm, symlink, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEntry } from "./create-entry";

let root = "";
let outside = "";

beforeEach(async () => {
  // `realpath`, because `tmpdir()` is a symlink on macOS (`/var` → `/private/var`)
  // and the guard canonicalizes both sides — the returned path is the
  // canonical one, so the expectations have to be too.
  root = await realpath(await mkdtemp(path.join(tmpdir(), "deck-create-entry-")));
  outside = await realpath(await mkdtemp(path.join(tmpdir(), "deck-create-entry-out-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("createEntry", () => {
  it("creates an empty file", async () => {
    const result = await createEntry({ root, parent: root, name: "notes.md", kind: "file" });
    expect(result).toEqual({ path: path.join(root, "notes.md") });
    expect((await stat(result.path)).size).toBe(0);
  });

  it("creates one directory, never a chain", async () => {
    const result = await createEntry({ root, parent: root, name: "src", kind: "directory" });
    expect((await stat(result.path)).isDirectory()).toBe(true);
    await expect(
      createEntry({ root, parent: path.join(root, "missing"), name: "deep", kind: "directory" }),
    ).rejects.toThrow("outside the workspace");
  });

  it("creates inside a nested parent", async () => {
    await mkdir(path.join(root, "src"));
    const result = await createEntry({
      root,
      parent: path.join(root, "src"),
      name: "index.ts",
      kind: "file",
    });
    expect(result.path).toBe(path.join(root, "src", "index.ts"));
  });

  it("refuses an existing entry of either kind with one message", async () => {
    await writeFile(path.join(root, "taken.md"), "x");
    await mkdir(path.join(root, "folder"));
    await expect(
      createEntry({ root, parent: root, name: "taken.md", kind: "file" }),
    ).rejects.toThrow("already exists");
    await expect(
      createEntry({ root, parent: root, name: "folder", kind: "directory" }),
    ).rejects.toThrow("already exists");
  });

  it("refuses a destination that is already a symlink", async () => {
    // Design §6.1: `wx` is `O_CREAT | O_EXCL` and fails if anything is there,
    // a symlink included — the same reasoning `writeFileAtomically`'s temp
    // file carries. Without it, New File would follow the link out.
    await symlink(path.join(outside, "target.txt"), path.join(root, "link.txt"));
    await expect(
      createEntry({ root, parent: root, name: "link.txt", kind: "file" }),
    ).rejects.toThrow("outside the workspace");
    await expect(stat(path.join(outside, "target.txt"))).rejects.toThrow("ENOENT");
  });

  it("refuses a parent outside the named root", async () => {
    await expect(
      createEntry({ root, parent: outside, name: "escape.txt", kind: "file" }),
    ).rejects.toThrow("outside the workspace");
  });

  it("refuses a parent that reaches outside through a symlink", async () => {
    await symlink(outside, path.join(root, "away"));
    await expect(
      createEntry({ root, parent: path.join(root, "away"), name: "x.txt", kind: "file" }),
    ).rejects.toThrow("outside the workspace");
  });

  it("refuses an invalid name with the validator's own reason", async () => {
    await expect(createEntry({ root, parent: root, name: "a/b", kind: "file" })).rejects.toThrow(
      "path separator",
    );
    await expect(createEntry({ root, parent: root, name: "CON", kind: "file" })).rejects.toThrow(
      "reserved on Windows",
    );
  });

  it("accepts a leading dot", async () => {
    const result = await createEntry({ root, parent: root, name: ".env", kind: "file" });
    expect(result.path).toBe(path.join(root, ".env"));
  });

  it("refuses a kind it does not know", async () => {
    await expect(
      createEntry({ root, parent: root, name: "x", kind: "socket" as never }),
    ).rejects.toThrow("Deck can only create a file or a folder.");
  });
});
