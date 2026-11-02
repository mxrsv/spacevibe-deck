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

/** A repository with no favicon often still keeps a logo; a favicon wins because it is drawn small. */
const LOGO_CANDIDATES = [
  "logo.svg",
  "logo.png",
  "icon.svg",
  "icon.png",
  "public/logo.svg",
  "public/logo.png",
  "public/icon.svg",
  "public/icon.png",
  "public/apple-touch-icon.png",
  "app/icon.svg",
  "app/icon.png",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
  "assets/icon.svg",
  "assets/icon.png",
  "src/assets/logo.svg",
  "src/assets/logo.png",
] as const;

const APP_ICON_SET = "AppIcon.appiconset";
const APP_ICON_SEARCH_DEPTH = 3;
/** Twice the rail's mark on a Retina display, so the smallest file that stays sharp is chosen. */
const APP_ICON_TARGET_PX = 64;
const APP_ICON_SKIPPED_DIRS = new Set(["node_modules", "build", "dist", "DerivedData", "Pods"]);

/** A data URL of `target` when it is a regular file resolving inside `root`, else null. */
async function readContainedImage(root: string, target: string): Promise<string | null> {
  try {
    const resolved = await fs.realpath(target);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return null;
    }
    if (!(await fs.stat(resolved)).isFile()) {
      return null;
    }
    return await readImageAtResolvedPath(resolved);
  } catch {
    return null; // Missing or unreadable: the caller tries its next candidate.
  }
}

async function firstContainedImage(
  root: string,
  dir: string,
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    // oxlint-disable-next-line no-await-in-loop -- the list is a priority order.
    const image = await readContainedImage(root, path.join(dir, candidate));
    if (image !== null) return image;
  }
  return null;
}

/**
 * Only a folder that says it is an Apple project is walked. The rail scans every project it draws,
 * and a project can be the home folder, where walking would raise macOS's permission prompts for
 * Documents and Desktop with no user gesture.
 */
async function isAppleProject(dir: string): Promise<boolean> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  return names.some(
    (name) => name === "Package.swift" || name === "project.yml" || name.endsWith(".xcodeproj"),
  );
}

/** Symlinks are not followed, so the walk stays inside the project. */
async function findAppIconSet(dir: string, depth: number): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const folders = entries.filter(
    (entry) =>
      entry.isDirectory() && !entry.name.startsWith(".") && !APP_ICON_SKIPPED_DIRS.has(entry.name),
  );
  if (folders.some((entry) => entry.name === APP_ICON_SET)) {
    return path.join(dir, APP_ICON_SET);
  }
  if (depth === 0) return null;
  for (const folder of folders) {
    // oxlint-disable-next-line no-await-in-loop -- a depth-first search stops at the first set.
    const found = await findAppIconSet(path.join(dir, folder.name), depth - 1);
    if (found !== null) return found;
  }
  return null;
}

/** The set's PNG files from its manifest, the smallest that reaches the target first. */
async function appIconFiles(iconSet: string): Promise<string[]> {
  const manifest: unknown = JSON.parse(
    await fs.readFile(path.join(iconSet, "Contents.json"), "utf8"),
  );
  const images = (manifest as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  const sized = images.flatMap((image: { filename?: unknown; size?: unknown; scale?: unknown }) => {
    if (typeof image.filename !== "string" || !image.filename.endsWith(".png")) return [];
    const px = Number.parseFloat(String(image.size)) * Number.parseFloat(String(image.scale));
    return Number.isFinite(px) ? [{ file: image.filename, px }] : [];
  });
  const rank = (px: number): number =>
    px >= APP_ICON_TARGET_PX ? px : APP_ICON_TARGET_PX * 1e3 - px;
  return sized.sort((a, b) => rank(a.px) - rank(b.px)).map((entry) => entry.file);
}

async function scanAppIcon(root: string, dir: string): Promise<string | null> {
  if (!(await isAppleProject(dir))) return null;
  const iconSet = await findAppIconSet(dir, APP_ICON_SEARCH_DEPTH);
  if (iconSet === null) return null;
  const files = await appIconFiles(iconSet).catch(() => []);
  return firstContainedImage(root, iconSet, files);
}

/**
 * A project's mark under `dir` as a data URL, or null: its favicon, else its logo, else its macOS
 * app icon. Default workspace logo.
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
  return (
    (await firstContainedImage(root, dir, FAVICON_CANDIDATES)) ??
    (await firstContainedImage(root, dir, LOGO_CANDIDATES)) ??
    (await scanAppIcon(root, dir))
  );
}
