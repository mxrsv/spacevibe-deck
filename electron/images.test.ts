/** Translated from `src-tauri/src/images.rs`. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readImageAsDataUrl, scanWorkspaceFavicon } from "./images";

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

describe("readImageAsDataUrl", () => {
  it("encodes a png as a data URL", async () => {
    const file = join(tempDir(), "logo.png");
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(await readImageAsDataUrl(file)).toBe("data:image/png;base64,iVBORw==");
  });

  it("is case-insensitive about the extension", async () => {
    const file = join(tempDir(), "Logo.PNG");
    writeFileSync(file, Buffer.from([0x89]));

    await expect(readImageAsDataUrl(file)).resolves.toContain("data:image/png");
  });

  it("maps each allowlisted extension to its mime type", async () => {
    const dir = tempDir();
    for (const [name, mime] of [
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.svg", "image/svg+xml"],
      ["a.webp", "image/webp"],
      ["a.ico", "image/x-icon"],
    ] as const) {
      const file = join(dir, name);
      writeFileSync(file, "x");
      await expect(readImageAsDataUrl(file)).resolves.toContain(`data:${mime}`);
    }
  });

  it("rejects an unsupported type with a user-facing message", async () => {
    const file = join(tempDir(), "notes.txt");
    writeFileSync(file, "x");

    await expect(readImageAsDataUrl(file)).rejects.toThrow(/Unsupported image type/);
  });

  it("rejects a file over the 1 MB cap", async () => {
    // A data URL is stored and re-read in full, so the cap is what keeps the
    // store small.
    const file = join(tempDir(), "big.png");
    writeFileSync(file, Buffer.alloc(1_048_577));

    await expect(readImageAsDataUrl(file)).rejects.toThrow(/too large/);
  });

  it("rejects a missing file", async () => {
    await expect(readImageAsDataUrl(join(tempDir(), "gone.png"))).rejects.toThrow(/Couldn't read/);
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
});
