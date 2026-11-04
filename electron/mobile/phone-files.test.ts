import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_READ_BYTES } from "../../mobile/protocol/src/limits";
import { PhoneError } from "./phone-error";
import { createPhoneFiles } from "./phone-files";

let base: string;
let root: string;
const outside = () => path.join(base, "outside.txt");

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "deck-phone-files-"));
  root = path.join(base, "project");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "hello\n");
  writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
  writeFileSync(path.join(root, "image.bin"), Buffer.from([1, 2, 0, 3]));
  writeFileSync(outside(), "secret");
  symlinkSync(outside(), path.join(root, "escape.txt"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function files(known: string[] = [root]) {
  return createPhoneFiles({ isKnownRoot: async (candidate) => known.includes(candidate) });
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof PhoneError ? error.code : "other";
  }
}

describe("phone files", () => {
  it("lists a directory, folders first, without .git and without links that leave the root", async () => {
    mkdirSync(path.join(root, ".git"));
    const entries = await files().list(root, "");
    expect(entries.map((entry) => entry.name)).toEqual(["src", "image.bin", "README.md"]);
    expect(entries[0]).toMatchObject({ kind: "dir", size: 0 });
    expect(entries[2]).toMatchObject({ kind: "file", size: 6 });
  });

  it("reads text, flags binary, and truncates at the byte cap", async () => {
    expect(await files().read(root, "README.md")).toEqual({
      text: "hello\n",
      truncated: false,
      binary: false,
    });
    expect(await files().read(root, "image.bin")).toEqual({
      text: "",
      truncated: false,
      binary: true,
    });
    writeFileSync(path.join(root, "big.txt"), "a".repeat(MAX_READ_BYTES + 10));
    const big = await files().read(root, "big.txt");
    expect(big.truncated).toBe(true);
    expect(big.text.length).toBe(MAX_READ_BYTES);
  });

  it("refuses roots nobody reported, climbing paths and symlinks out of the root", async () => {
    expect(await code(files([]).list(root, ""))).toBe("outside-root");
    expect(await code(files().read(root, "../outside.txt"))).toBe("outside-root");
    expect(await code(files().read(root, outside()))).toBe("outside-root");
    expect(await code(files().read(root, "escape.txt"))).toBe("outside-root");
    expect(await code(files().list(root, ".."))).toBe("outside-root");
  });

  it("says not-found for a path that does not exist", async () => {
    expect(await code(files().read(root, "nope.txt"))).toBe("not-found");
    expect(await code(files().list(root, "nope"))).toBe("not-found");
  });
});
