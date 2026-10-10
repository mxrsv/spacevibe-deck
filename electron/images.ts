/**
 * Image reading — the port of `src-tauri/src/images.rs`.
 *
 * Logos are swallowed into the app as data URLs so they survive the original
 * file being moved or deleted, and so no asset-protocol scope is needed. The
 * 1 MB cap is why: a data URL is stored and re-read in full every time.
 */
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { assertInsideRoot } from "./fs/path-guard";

const MAX_LOGO_BYTES = 1_048_576; // 1 MB

class ImageValidationError extends Error {}

/** MIME type for an allowlisted extension, case-insensitive so `Logo.PNG`
 * works. `.ico` is included for favicons. */
function mimeFor(target: string): string | null {
  switch (path.extname(target).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return null;
  }
}

/** Errors are human-readable because they reach the settings UI verbatim. */
async function readImageAtResolvedPath(target: string): Promise<string> {
  const mime = mimeFor(target);
  if (mime === null) {
    throw new Error("Unsupported image type — use .png, .jpg, .svg or .webp");
  }
  const safeFlags =
    process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | safeFlags);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ImageValidationError("Not a regular file");
    if (stat.size > MAX_LOGO_BYTES) {
      throw new ImageValidationError("Image is too large (max 1 MB)");
    }
    const bytes = Buffer.alloc(MAX_LOGO_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      // oxlint-disable-next-line no-await-in-loop -- sequential reads share one bounded handle.
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_LOGO_BYTES) {
      throw new ImageValidationError("Image is too large (max 1 MB)");
    }
    return `data:${mime};base64,${bytes.subarray(0, offset).toString("base64")}`;
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new Error("Couldn't read the image file", { cause: error });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Read an image only when its path resolves inside a main-authorized root. */
export async function readWorkspaceImageAsDataUrl(
  target: string,
  roots: readonly string[],
): Promise<string> {
  for (const root of roots) {
    let canonical: string;
    try {
      canonical = assertInsideRoot(root, target);
    } catch {
      // Try another authorized root.
      continue;
    }
    return readImageAtResolvedPath(canonical);
  }
  throw new Error("Image is outside an authorized workspace");
}

export async function pickImageAsDataUrl(
  window?: import("electron").BrowserWindow,
): Promise<string | null> {
  const { dialog } = await import("electron");
  const options: import("electron").OpenDialogOptions = {
    properties: ["openFile"],
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "svg", "webp"] }],
  };
  const result =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  return result.canceled || result.filePaths[0] === undefined
    ? null
    : readImageAtResolvedPath(await fs.realpath(result.filePaths[0]));
}

/** In-repo favicon locations, checked in order; the first that encodes wins. */
const FAVICON_CANDIDATES = [
  "favicon.ico",
  "favicon.png",
  "favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "public/favicon.svg",
  "src/app/favicon.ico",
  "src/favicon.ico",
  "static/favicon.ico",
  "static/favicon.png",
  "assets/favicon.ico",
  "app/favicon.ico",
] as const;

/**
 * A project favicon under `dir` as a data URL, or null. Default workspace logo.
 *
 * Every candidate must resolve to a real file INSIDE `dir`. The rail scans
 * this for every project it draws, with no user gesture, so a repository
 * shipping `favicon.png` as a symlink out of the tree would otherwise hand any
 * file the user can read back to the renderer as image bytes. Containment is
 * checked on the RESOLVED path, so a link that stays inside still works and a
 * link planted higher up the candidate's own path is caught too.
 */
export async function scanWorkspaceFavicon(dir: string): Promise<string | null> {
  const root = await fs.realpath(dir).catch(() => null);
  if (root === null) {
    return null;
  }
  for (const candidate of FAVICON_CANDIDATES) {
    const target = path.join(dir, candidate);
    try {
      const resolved = await fs.realpath(target);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        continue;
      }
      if (!(await fs.stat(resolved)).isFile()) {
        continue;
      }
      return await readImageAtResolvedPath(resolved);
    } catch {
      // Missing or unreadable: try the next candidate.
    }
  }
  return null;
}
