import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_EDITABLE_BYTES } from "../../src/files/file-content";
import { PathOutsideWorkspaceError } from "./path-guard";
import { listDir, readFile, statFiles } from "./read";

let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  // `os.tmpdir()` is itself a symlink on macOS (`/var` -> `/private/var`), and
  // every path the host returns has already been through `path-guard`'s
  // realpath. Canonicalize the fixture root once so the expectations compare
  // realpath to realpath instead of asserting that the guard does not resolve.
  base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deck-fs-read-")),
  );
  root = path.join(base, "workspace");
  outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, "src", "index.ts"), "const a = 1;\n");
  fs.writeFileSync(path.join(root, "readme.md"), "# hi\r\nthere\r\n");
  fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([1, 0, 2, 3]));
  fs.writeFileSync(path.join(outside, "secret.txt"), "no\n");
  fs.symlinkSync(outside, path.join(root, "away"));
  fs.symlinkSync(path.join(root, "src"), path.join(root, "src-link"));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("listDir", () => {
  it("lists one directory, non-recursively", async () => {
    const rows = await listDir(root, root);
    expect(rows.map((row) => row.name).sort()).toEqual([
      "away",
      "binary.bin",
      "node_modules",
      "readme.md",
      "src",
      "src-link",
    ]);
    // The exclusion list is the RENDERER's (`file-tree.ts`): the host reports
    // what is there, so a "show hidden" toggle needs no second round-trip.
    expect(rows.find((row) => row.name === "node_modules")?.directory).toBe(
      true,
    );
  });

  it("flags a symlink resolving out of the root and calls it a leaf", async () => {
    const rows = await listDir(root, root);
    const away = rows.find((row) => row.name === "away");
    expect(away).toEqual({
      name: "away",
      path: path.join(root, "away"),
      directory: false,
      outOfRoot: true,
    });
  });

  it("follows a symlink that points back into the root", async () => {
    const rows = await listDir(root, root);
    const link = rows.find((row) => row.name === "src-link");
    expect(link?.outOfRoot).toBe(false);
    expect(link?.directory).toBe(true);
  });

  it("refuses a directory outside the root", async () => {
    await expect(listDir(root, outside)).rejects.toThrow(
      PathOutsideWorkspaceError,
    );
    await expect(listDir(root, path.join(root, "away"))).rejects.toThrow(
      PathOutsideWorkspaceError,
    );
  });
});

describe("statFiles", () => {
  it("answers a whole batch in one call, index-aligned", async () => {
    const results = await statFiles(root, [
      path.join(root, "src", "index.ts"),
      path.join(root, "missing.ts"),
      path.join(outside, "secret.txt"),
    ]);
    expect(results.map((r) => r.exists)).toEqual([true, false, false]);
    expect(results[0].size).toBe(13);
    expect(results[0].mtimeMs).toBeGreaterThan(0);
    // The path comes back exactly as asked, so the caller can key on it.
    expect(results[2].path).toBe(path.join(outside, "secret.txt"));
  });

  it("reports a path outside the root as absent rather than throwing", async () => {
    // A batch is the focus/activation reconcile; one bad entry must not take
    // the whole reconcile down with it.
    const [result] = await statFiles(root, [path.join(outside, "secret.txt")]);
    expect(result).toEqual({
      path: path.join(outside, "secret.txt"),
      exists: false,
      mtimeMs: null,
      size: null,
    });
  });
});

describe("readFile", () => {
  it("returns content, EOL, encoding and the mtime the reconcile needs", async () => {
    const result = await readFile(root, path.join(root, "src", "index.ts"));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.content).toBe("const a = 1;\n");
    expect(result.eol).toBe("lf");
    expect(result.readOnly).toBe(false);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(result.size).toBe(13);
  });

  it("detects CRLF and hands the editor LF", async () => {
    const result = await readFile(root, path.join(root, "readme.md"));
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.eol).toBe("crlf");
    expect(result.content).toBe("# hi\nthere\n");
  });

  it("refuses binary content with a stated reason", async () => {
    const result = await readFile(root, path.join(root, "binary.bin"));
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toContain("binary");
  });

  it("refuses a file too large to open, WITHOUT reading it", async () => {
    // Spec §11 item 13 expects a 50 MB file to refuse. The check runs off
    // `stat`, so a sparse file proves the bytes were never read: reading 50 MB
    // here would take far longer than this test does.
    const huge = path.join(root, "huge.log");
    const handle = fs.openSync(huge, "w");
    fs.ftruncateSync(handle, 50 * 1024 * 1024);
    fs.closeSync(handle);
    const result = await readFile(root, huge);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.reason).toContain("too large");
    fs.rmSync(huge);
  });

  it("opens a file above the editing limit read-only, with a reason", async () => {
    const big = path.join(root, "big.txt");
    fs.writeFileSync(big, "a".repeat(MAX_EDITABLE_BYTES + 10));
    const result = await readFile(root, big);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.readOnly).toBe(true);
    expect(result.reason).toContain("read-only");
    fs.rmSync(big);
  });

  it("opens a file the process cannot write read-only, with a reason", async () => {
    const locked = path.join(root, "locked.txt");
    fs.writeFileSync(locked, "hello\n");
    fs.chmodSync(locked, 0o444);
    const result = await readFile(root, locked);
    if (result.kind !== "ok") throw new Error("expected ok");
    // Running as root defeats the permission bit entirely; only assert the
    // rule where the OS can actually enforce it.
    if (!result.writable) {
      expect(result.readOnly).toBe(true);
      expect(result.reason).toContain("not writable");
    }
    fs.chmodSync(locked, 0o644);
    fs.rmSync(locked);
  });

  it("refuses a file outside the root", async () => {
    await expect(
      readFile(root, path.join(outside, "secret.txt")),
    ).rejects.toThrow(PathOutsideWorkspaceError);
    await expect(
      readFile(root, path.join(root, "away", "secret.txt")),
    ).rejects.toThrow(PathOutsideWorkspaceError);
  });

  it("refuses a directory", async () => {
    const result = await readFile(root, path.join(root, "src"));
    expect(result).toEqual({ kind: "refused", reason: "That is not a file." });
  });
});
