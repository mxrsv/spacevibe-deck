/** Translated from `src-tauri/src/images.rs`. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickImageAsDataUrl, readWorkspaceImageAsDataUrl, scanWorkspaceFavicon } from "./images";

const mocks = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showOpenDialog: mocks.showOpenDialog } }));

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck-images-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readWorkspaceImageAsDataUrl", () => {
  it("reads an image inside an authorized workspace", async () => {
    const root = tempDir();
    const file = join(root, "logo.png");
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await expect(readWorkspaceImageAsDataUrl(file, [root])).resolves.toBe(
      "data:image/png;base64,iVBORw==",
    );
  });

  it("rejects paths outside authorized roots and symlink escapes", async () => {
    const root = tempDir();
    const outside = tempDir();
    const secret = join(outside, "secret.png");
    writeFileSync(secret, "private");
    symlinkSync(secret, join(root, "escape.png"));

    await expect(readWorkspaceImageAsDataUrl(secret, [root])).rejects.toThrow(
      /outside an authorized workspace/,
    );
    await expect(readWorkspaceImageAsDataUrl(join(root, "escape.png"), [root])).rejects.toThrow(
      /outside an authorized workspace/,
    );
  });

  it("rejects oversized and non-regular image paths", async () => {
    const root = tempDir();
    const oversized = join(root, "large.png");
    const directory = join(root, "folder.png");
    writeFileSync(oversized, Buffer.alloc(1_048_577));
    mkdirSync(directory);

    await expect(readWorkspaceImageAsDataUrl(oversized, [root])).rejects.toThrow(
      "Image is too large (max 1 MB)",
    );
    await expect(readWorkspaceImageAsDataUrl(directory, [root])).rejects.toThrow(
      "Not a regular file",
    );
  });
});

describe("pickImageAsDataUrl", () => {
  it("returns null when the native picker is cancelled", async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });

    await expect(pickImageAsDataUrl()).resolves.toBeNull();
  });

  it("rejects a selected file with an unsupported image type", async () => {
    const file = join(tempDir(), "notes.txt");
    writeFileSync(file, "text");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] });

    await expect(pickImageAsDataUrl()).rejects.toThrow(/Unsupported image type/);
  });
});

describe("scanWorkspaceFavicon", () => {
  it("finds a favicon at the repo root", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "favicon.ico"), "x");

    await expect(scanWorkspaceFavicon(dir)).resolves.toContain("data:image/x-icon");
  });

  it("checks candidates in order, preferring the root", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "public"));
    writeFileSync(join(dir, "favicon.svg"), "root");
    writeFileSync(join(dir, "public", "favicon.ico"), "nested");

    // favicon.ico (root) is absent, so favicon.svg wins over public/favicon.ico.
    await expect(scanWorkspaceFavicon(dir)).resolves.toContain("image/svg+xml");
  });

  it("finds a nested favicon when the root has none", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "src", "app"), { recursive: true });
    writeFileSync(join(dir, "src", "app", "favicon.ico"), "x");

    await expect(scanWorkspaceFavicon(dir)).resolves.toContain("data:image/x-icon");
  });

  it("returns null for a folder with no favicon", async () => {
    await expect(scanWorkspaceFavicon(tempDir())).resolves.toBe(null);
  });

  // The rail scans every project it draws, so a repository must not be able to
  // point a candidate at a file outside itself and get its bytes back.
  it("refuses a candidate that links outside the workspace", async () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, "secret.png"), "private");
    symlinkSync(join(outside, "secret.png"), join(dir, "favicon.png"));

    await expect(scanWorkspaceFavicon(dir)).resolves.toBe(null);
  });

  it("still reads a symlink that stays inside the workspace", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "mark.png"), "x");
    symlinkSync(join(dir, "assets", "mark.png"), join(dir, "favicon.png"));

    await expect(scanWorkspaceFavicon(dir)).resolves.toContain("data:image/png");
  });
});
