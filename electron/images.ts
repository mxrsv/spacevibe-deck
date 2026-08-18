/**
 * Image reading — the port of `src-tauri/src/images.rs`.
 *
 * Logos are swallowed into the app as data URLs so they survive the original
 * file being moved or deleted, and so no asset-protocol scope is needed. The
 * 1 MB cap is why: a data URL is stored and re-read in full every time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_LOGO_BYTES = 1_048_576; // 1 MB

/** MIME type for an allowlisted extension, case-insensitive so `Logo.PNG`
 * works. `.ico` is included for favicons. */
function mimeFor(target: string): string | null {
  switch (path.extname(target).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    default:
      return null;
  }
}

/** Errors are human-readable because they reach the settings UI verbatim. */
export async function readImageAsDataUrl(target: string): Promise<string> {
  const mime = mimeFor(target);
  if (mime === null) {
    throw new Error('Unsupported image type — use .png, .jpg, .svg or .webp');
  }
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new Error("Couldn't read the image file");
  }
  if (stat.size > MAX_LOGO_BYTES) {
    throw new Error('Image is too large (max 1 MB)');
  }
  try {
    const bytes = await fs.readFile(target);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    throw new Error("Couldn't read the image file");
  }
}

/** In-repo favicon locations, checked in order; the first that encodes wins. */
const FAVICON_CANDIDATES = [
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'public/favicon.svg',
  'src/app/favicon.ico',
  'src/favicon.ico',
  'static/favicon.ico',
  'static/favicon.png',
  'assets/favicon.ico',
  'app/favicon.ico',
] as const;

/** A project favicon under `dir` as a data URL, or null. Default workspace logo. */
export async function scanWorkspaceFavicon(dir: string): Promise<string | null> {
  for (const candidate of FAVICON_CANDIDATES) {
    const target = path.join(dir, candidate);
    try {
      if (!(await fs.stat(target)).isFile()) {
        continue;
      }
      return await readImageAsDataUrl(target);
    } catch {
      // Missing or unreadable: try the next candidate.
    }
  }
  return null;
}
