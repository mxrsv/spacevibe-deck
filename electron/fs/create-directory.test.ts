import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectory } from "./create-directory";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "deck-create-directory-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createDirectory", () => {
  it("creates exactly one empty child directory", async () => {
    const result = await createDirectory({ parent: root, name: "new-workspace" });
    expect(result).toEqual({ path: path.join(root, "new-workspace") });
  });

  it.each(["", ".hidden", "..", "../escape", "a/b", "a\\b"])(
    "rejects the unsafe name %j",
    async (name) => {
      await expect(createDirectory({ parent: root, name })).rejects.toThrow("valid folder name");
    },
  );

  it("rejects a parent that does not exist", async () => {
    await expect(
      createDirectory({ parent: path.join(root, "missing"), name: "child" }),
    ).rejects.toThrow("Parent folder");
  });

  it("rejects a parent that is a file", async () => {
    const file = path.join(root, "file.txt");
    await writeFile(file, "x", "utf8");
    await expect(createDirectory({ parent: file, name: "child" })).rejects.toThrow("Parent folder");
  });

  it("rejects an existing destination", async () => {
    await mkdir(path.join(root, "taken"));
    await expect(createDirectory({ parent: root, name: "taken" })).rejects.toThrow(
      "already exists",
    );
  });
});
