import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsAsync from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAX_EDITABLE_BYTES } from "../../src/files/file-content";
import { PathOutsideWorkspaceError } from "./path-guard";
import {
  listDir,
  MalformedStatRequestError,
  MAX_REALPATH_CONCURRENCY,
  MAX_STAT_PATHS,
  readFile,
  statFiles,
  TooManyStatPathsError,
  type DirEntryPayload,
} from "./read";

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
  fs.symlinkSync(
    path.join(root, "does-not-exist"),
    path.join(root, "dangling-link"),
  );
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
      "dangling-link",
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

  it("flags a dangling symlink as a leaf, not out of root by escaping", async () => {
    const rows = await listDir(root, root);
    const dangling = rows.find((row) => row.name === "dangling-link");
    expect(dangling).toEqual({
      name: "dangling-link",
      path: path.join(root, "dangling-link"),
      directory: false,
      outOfRoot: true,
    });
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

/**
 * Independent, synchronous reference implementation of the pre-T10 per-entry
 * `realpathSync` algorithm that `listDir` used before this task — the parity
 * oracle for the bounded-async version under test. Deliberately does not
 * import from `read.ts` or `path-guard.ts`, so it proves the new code against
 * a fixed, hand-written ground truth rather than against itself.
 */
function listDirSyncReference(
  canonicalRoot: string,
  directory: string,
): DirEntryPayload[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const rows: DirEntryPayload[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (!entry.isSymbolicLink()) {
      rows.push({
        name: entry.name,
        path: full,
        directory: entry.isDirectory(),
        outOfRoot: false,
      });
      continue;
    }
    let canonical: string;
    try {
      canonical = fs.realpathSync(full);
    } catch {
      rows.push({
        name: entry.name,
        path: full,
        directory: false,
        outOfRoot: true,
      });
      continue;
    }
    const relative = path.relative(canonicalRoot, canonical);
    const inside =
      canonical === canonicalRoot ||
      (relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative));
    if (!inside) {
      rows.push({
        name: entry.name,
        path: full,
        directory: false,
        outOfRoot: true,
      });
      continue;
    }
    let directoryTarget = false;
    try {
      directoryTarget = fs.statSync(canonical).isDirectory();
    } catch {
      directoryTarget = false;
    }
    rows.push({
      name: entry.name,
      path: full,
      directory: directoryTarget,
      outOfRoot: false,
    });
  }
  return rows;
}

describe("listDir — bounded async realpath on a 10k-entry directory", () => {
  // A directory dominated by symlinks with no natural yield point between
  // them is the stall case (plan T10): before this task, every symlink
  // called `realpathSync` synchronously and the branch that resolves out of
  // root or dangling never hit an `await` at all, so a long run of such
  // entries blocked the event loop back to back.
  const PLAIN_FILE_COUNT = 4000;
  const PLAIN_DIR_COUNT = 2000;
  const SYMLINK_TO_FILE_COUNT = 2000;
  const SYMLINK_ESCAPING_COUNT = 1000;
  const DANGLING_SYMLINK_COUNT = 1000;
  const TOTAL_ENTRIES =
    PLAIN_FILE_COUNT +
    PLAIN_DIR_COUNT +
    SYMLINK_TO_FILE_COUNT +
    SYMLINK_ESCAPING_COUNT +
    DANGLING_SYMLINK_COUNT;
  const SYMLINK_COUNT =
    SYMLINK_TO_FILE_COUNT + SYMLINK_ESCAPING_COUNT + DANGLING_SYMLINK_COUNT;

  let bigBase: string;
  let bigRoot: string;
  let bigDir: string;

  beforeAll(() => {
    bigBase = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "deck-fs-read-10k-")),
    );
    bigRoot = path.join(bigBase, "workspace");
    const bigOutside = path.join(bigBase, "outside");
    bigDir = path.join(bigRoot, "many");
    fs.mkdirSync(bigDir, { recursive: true });
    fs.mkdirSync(bigOutside, { recursive: true });
    for (let i = 0; i < PLAIN_FILE_COUNT; i += 1) {
      fs.writeFileSync(path.join(bigDir, `file-${i}.txt`), "x");
    }
    for (let i = 0; i < PLAIN_DIR_COUNT; i += 1) {
      fs.mkdirSync(path.join(bigDir, `dir-${i}`));
    }
    const symlinkTarget = path.join(bigDir, "file-0.txt");
    for (let i = 0; i < SYMLINK_TO_FILE_COUNT; i += 1) {
      fs.symlinkSync(symlinkTarget, path.join(bigDir, `link-to-file-${i}`));
    }
    for (let i = 0; i < SYMLINK_ESCAPING_COUNT; i += 1) {
      fs.symlinkSync(bigOutside, path.join(bigDir, `link-escaping-${i}`));
    }
    for (let i = 0; i < DANGLING_SYMLINK_COUNT; i += 1) {
      fs.symlinkSync(
        path.join(bigDir, "does-not-exist"),
        path.join(bigDir, `link-dangling-${i}`),
      );
    }
  }, 60_000);

  afterAll(() => {
    fs.rmSync(bigBase, { recursive: true, force: true });
  });

  it("exports MAX_REALPATH_CONCURRENCY as 32", () => {
    expect(MAX_REALPATH_CONCURRENCY).toBe(32);
  });

  it("resolves every symlink through fs.realpath, at most MAX_REALPATH_CONCURRENCY in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let callCount = 0;
    const real = fsAsync.realpath.bind(fsAsync);
    const spy = vi
      .spyOn(fsAsync, "realpath")
      .mockImplementation(
        async (...args: Parameters<typeof fsAsync.realpath>) => {
          callCount += 1;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (real as any)(...args);
          } finally {
            inFlight -= 1;
          }
        },
      );
    try {
      const rows = await listDir(bigRoot, bigDir);
      expect(rows).toHaveLength(TOTAL_ENTRIES);
      expect(callCount).toBe(SYMLINK_COUNT);
      expect(maxInFlight).toBe(MAX_REALPATH_CONCURRENCY);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it("matches the pre-T10 synchronous resolution algorithm, sorted by path", async () => {
    const expected = listDirSyncReference(bigRoot, bigDir).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const actual = (await listDir(bigRoot, bigDir)).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    expect(actual).toEqual(expected);
  }, 60_000);
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

  it("reports a symlink escaping the root as absent rather than throwing", async () => {
    const [result] = await statFiles(root, [
      path.join(root, "away", "secret.txt"),
    ]);
    expect(result.exists).toBe(false);
  });

  it("rejects a malformed payload that is not an array", async () => {
    await expect(statFiles(root, null as unknown as string[])).rejects.toThrow(
      MalformedStatRequestError,
    );
    await expect(
      statFiles(root, "index.ts" as unknown as string[]),
    ).rejects.toThrow(MalformedStatRequestError);
  });

  it("rejects a payload whose entries are not strings", async () => {
    await expect(statFiles(root, [123 as unknown as string])).rejects.toThrow(
      MalformedStatRequestError,
    );
  });

  it("rejects a batch one over MAX_STAT_PATHS", async () => {
    const paths = Array.from({ length: MAX_STAT_PATHS + 1 }, (_, index) =>
      path.join(root, `file-${index}.ts`),
    );
    await expect(statFiles(root, paths)).rejects.toThrow(TooManyStatPathsError);
  });

  it("accepts a batch exactly at MAX_STAT_PATHS", async () => {
    const paths = Array.from({ length: MAX_STAT_PATHS }, (_, index) =>
      path.join(root, `file-${index}.ts`),
    );
    await expect(statFiles(root, paths)).resolves.toHaveLength(MAX_STAT_PATHS);
  });

  it("keeps duplicate paths index-aligned rather than deduping them", async () => {
    const target = path.join(root, "src", "index.ts");
    const results = await statFiles(root, [target, target]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].exists).toBe(true);
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
