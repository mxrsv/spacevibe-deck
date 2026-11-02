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

  it("falls back to a logo, and a favicon still wins over one", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "public"));
    writeFileSync(join(dir, "public", "logo.svg"), "logo");
    await expect(scanWorkspaceFavicon(dir, true)).resolves.toContain("image/svg+xml");

    writeFileSync(join(dir, "favicon.ico"), "x");
    await expect(scanWorkspaceFavicon(dir, true)).resolves.toContain("data:image/x-icon");
  });

  it("answers the old rail with the favicon alone", async () => {
    const logoOnly = tempDir();
    writeFileSync(join(logoOnly, "logo.svg"), "logo");
    await expect(scanWorkspaceFavicon(logoOnly)).resolves.toBe(null);

    const { dir } = appIconProject("Package.swift");
    await expect(scanWorkspaceFavicon(dir)).resolves.toBe(null);
  });

  it("reads an Xcode 14 single-size icon, whose entry has no scale", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "Package.swift"), "");
    const iconSet = join(dir, "App", "Assets.xcassets", "AppIcon.appiconset");
    mkdirSync(iconSet, { recursive: true });
    writeFileSync(
      join(iconSet, "Contents.json"),
      JSON.stringify({
        images: [{ filename: "icon.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
      }),
    );
    writeFileSync(join(iconSet, "icon.png"), "single");

    await expect(scanWorkspaceFavicon(dir, true)).resolves.toBe(
      `data:image/png;base64,${Buffer.from("single").toString("base64")}`,
    );
  });

  it("keeps looking past a set with no usable file, and skips a sample app's", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "Package.swift"), "");
    const emptySet = join(dir, "AWidget", "Assets.xcassets", "AppIcon.appiconset");
    mkdirSync(emptySet, { recursive: true });
    writeFileSync(join(emptySet, "Contents.json"), JSON.stringify({ images: [{ size: "64x64" }] }));
    for (const [folder, bytes] of [
      ["Examples", "sample"],
      ["Sources", "real"],
    ] as const) {
      const iconSet = join(dir, folder, "Assets.xcassets", "AppIcon.appiconset");
      mkdirSync(iconSet, { recursive: true });
      writeFileSync(
        join(iconSet, "Contents.json"),
        JSON.stringify({ images: [{ filename: "icon.png", size: "64x64", scale: "1x" }] }),
      );
      writeFileSync(join(iconSet, "icon.png"), bytes);
    }

    await expect(scanWorkspaceFavicon(dir, true)).resolves.toBe(
      `data:image/png;base64,${Buffer.from("real").toString("base64")}`,
    );
  });

  function appIconProject(marker: string | null): { dir: string; iconSet: string } {
    const dir = tempDir();
    const iconSet = join(dir, "App", "Assets.xcassets", "AppIcon.appiconset");
    mkdirSync(iconSet, { recursive: true });
    writeFileSync(
      join(iconSet, "Contents.json"),
      JSON.stringify({
        images: [
          { filename: "16.png", size: "16x16", scale: "1x" },
          { filename: "64.png", size: "32x32", scale: "2x" },
          { filename: "1024.png", size: "512x512", scale: "2x" },
        ],
      }),
    );
    for (const [file, bytes] of [
      ["16.png", "small"],
      ["64.png", "target"],
      ["1024.png", "large"],
    ]) {
      writeFileSync(join(iconSet, file as string), bytes as string);
    }
    if (marker !== null) writeFileSync(join(dir, marker), "");
    return { dir, iconSet };
  }

  it("reads a macOS app icon at the smallest size that stays sharp", async () => {
    const { dir } = appIconProject("Package.swift");
    const image = await scanWorkspaceFavicon(dir, true);
    expect(image).toBe(`data:image/png;base64,${Buffer.from("target").toString("base64")}`);
  });

  it("does not walk a folder that is not an Apple project", async () => {
    const { dir } = appIconProject(null);
    await expect(scanWorkspaceFavicon(dir, true)).resolves.toBe(null);
  });

  it("does not read an app icon linked out of the project", async () => {
    const { dir, iconSet } = appIconProject("Package.swift");
    const outside = join(tempDir(), "secret.png");
    writeFileSync(outside, "secret");
    for (const file of ["16.png", "64.png", "1024.png"]) rmSync(join(iconSet, file));
    symlinkSync(outside, join(iconSet, "64.png"));
    await expect(scanWorkspaceFavicon(dir, true)).resolves.toBe(null);
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
