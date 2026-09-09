/**
 * A throwaway loopback server over the BUILT landing (`dist`).
 *
 * Every capture gate shoots the built bundle rather than the dev server: the
 * bundle is what a visitor gets, and `npm run dev` proves nothing about hashed
 * assets, the copied root files or the production branch of `import.meta.env`.
 *
 * Extracted from `capture-landing-stage.mjs` on 2026-09-04 when the OG-cover
 * capture needed the same server; the behaviour is unchanged, including the
 * root escape that 403s rather than reading up the tree.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

export const DIST = resolve(import.meta.dirname, "../marketing/landing-prototype/dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Resolves to a listening `http.Server` on a free loopback port. */
export function serveLandingDist() {
  const server = createServer(async (request, response) => {
    let path = decodeURIComponent(request.url.split("?")[0]);

    if (path.endsWith("/")) {
      path += "index.html";
    }

    const file = join(DIST, normalize(path));

    if (!file.startsWith(DIST)) {
      response.writeHead(403).end("forbidden");
      return;
    }

    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });

  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => done(server));
  });
}
