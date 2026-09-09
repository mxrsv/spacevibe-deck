import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, defineConfig } from "vite";

const marketingRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(import.meta.dirname, "dist");

// Files the page references by absolute URL string (not by import), so Rollup
// never sees them. Paths are relative to the marketing root and mirrored
// verbatim into dist.
//
// The `deck-tour.*` render cut left this list on 2026-08-19 with the demo reel
// section that played it. The files stay in `marketing/` — the video pipeline
// still produces them (marketing/video/README.md) — they are simply no longer
// shipped, which is several megabytes the landing stopped carrying.
const RUNTIME_ASSETS = ["landing-prototype/assets"];

// Files served from the SITE ROOT rather than from `/landing-prototype/`.
// Copied by basename, so `landing-prototype/robots.txt` answers at
// `/robots.txt`. The install endpoints have taken this path since the
// bootstrap commands went into the README; `robots.txt` and `sitemap.xml`
// joined them because both are only valid at the root — a crawler reads
// `/robots.txt` and nothing else, and a sitemap may only list URLs at or below
// its own directory.
const ROOT_FILES = [
  "landing-prototype/install.sh",
  "landing-prototype/install.ps1",
  "landing-prototype/robots.txt",
  "landing-prototype/sitemap.xml",
];

function copyRuntimeAssets() {
  return {
    name: "copy-runtime-assets",
    closeBundle() {
      for (const path of RUNTIME_ASSETS) {
        const source = resolve(marketingRoot, path);

        if (!existsSync(source)) {
          throw new Error(
            `Landing build: runtime asset "${path}" is missing from marketing/. ` +
              "Publish the approved render cut there before building (marketing/video/README.md).",
          );
        }

        cpSync(source, resolve(outDir, path), { recursive: true });
      }

      for (const path of ROOT_FILES) {
        const source = resolve(marketingRoot, path);

        if (!existsSync(source)) {
          throw new Error(`Landing build: root file "${path}" is missing.`);
        }

        cpSync(source, resolve(outDir, path.split("/").at(-1)));
      }
    },
  };
}

// The landing renders itself from JavaScript: `index.html` ships an empty
// `<main id="specimen-root">` and `main.js` fills it on boot. Google executes
// that, but Bing, every social-card scraper and the AI answer engines that
// increasingly send developer traffic do not — they read the HTML and find a
// blank page.
//
// This pass runs the SAME renderers at build time and writes their markup into
// the shipped file, so the document a crawler downloads already carries the
// headline, the six feature panels and the footer. `main.js` then overwrites
// `innerHTML` with the identical string on boot; the static copy is a starting
// picture, never a second implementation.
//
// Two details make it safe:
//   · The SSR server runs in production mode, so `site-urls.js` resolves the
//     same canonical `/` and `/changelog` the shipped bundle uses.
//   · `renderDirectionA` reads its agent marks and brand icon through Vite
//     asset imports, which resolve to dev URLs under SSR. Every one is
//     rewritten to the hashed file Rollup actually emitted; an unmapped asset
//     URL fails the build rather than shipping a 404 into the markup.
const PRERENDER_ROOT = '<main id="specimen-root">';

/** `agent-claude-BXqk1t.svg` -> `agent-claude.svg`. */
function sourceName(file) {
  const dot = file.lastIndexOf(".");
  const stem = file.slice(0, dot);
  const dash = stem.lastIndexOf("-");

  return dash === -1 ? file : `${stem.slice(0, dash)}${file.slice(dot)}`;
}

const DATA_MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Point every asset URL in the SSR markup at something a browser can fetch.
 *
 * Two cases, because the client build has two answers. An asset over
 * `assetsInlineLimit` is emitted as a hashed file and matched here by its
 * source name. One under the limit is inlined into the bundle as a data URL
 * and has no file to match — so it is inlined HERE too, from the path SSR
 * handed back. Leaving it would ship the maintainer's own `file:///Users/...`
 * into production HTML, which is what the first run of this pass did.
 */
function rewriteAssetUrls(markup, emitted) {
  return markup.replace(/(src|href)="([^"]+)"/g, (whole, attribute, url) => {
    // Anchors share the `href` attribute with assets, and the map is keyed by
    // basename: `.../releases/latest` would look up `latest`. Nothing off this
    // machine is ever an asset of this build.
    if (/^https?:/.test(url)) {
      return whole;
    }

    const path = url.split("?")[0];
    const hashed = emitted.get(basename(path));

    if (hashed !== undefined) {
      return `${attribute}="${hashed}"`;
    }

    if (!path.startsWith("file://")) {
      return whole;
    }

    const file = fileURLToPath(path);
    const mime = DATA_MIME[extname(file)];

    if (mime === undefined || !existsSync(file)) {
      return whole;
    }

    return `${attribute}="data:${mime};base64,${readFileSync(file).toString("base64")}"`;
  });
}

function prerenderShell() {
  return {
    name: "prerender-landing-shell",
    async closeBundle() {
      const assetDir = resolve(outDir, "assets");
      const emitted = new Map(
        readdirSync(assetDir).map((file) => [sourceName(file), `/assets/${file}`]),
      );

      const server = await createServer({
        root: marketingRoot,
        configFile: false,
        mode: "production",
        logLevel: "error",
        server: { middlewareMode: true },
        appType: "custom",
      });

      let markup;

      try {
        const [{ messages }, { renderDirectionA }, { renderTour }] = await Promise.all([
          server.ssrLoadModule("/landing-prototype/src/copy.js"),
          server.ssrLoadModule("/landing-prototype/src/directions/a.js"),
          server.ssrLoadModule("/landing-prototype/src/tour/index.js"),
        ]);

        markup = renderDirectionA(messages.en).markup + renderTour(messages.en).markup;
      } finally {
        await server.close();
      }

      const page = resolve(outDir, "landing-prototype/index.html");
      const html = readFileSync(page, "utf8");

      if (!html.includes(PRERENDER_ROOT)) {
        throw new Error(
          `Landing build: prerender root "${PRERENDER_ROOT}" is missing from index.html.`,
        );
      }

      const resolved = rewriteAssetUrls(markup, emitted);
      const unresolved = [
        ...resolved.matchAll(/(?:src|href)="((?:file:|\/@fs|\.\.?\/)[^"]*)"/g),
      ];

      if (unresolved.length > 0) {
        throw new Error(
          `Landing build: prerendered markup kept ${unresolved.length} unresolved asset URL(s), ` +
            `first "${unresolved[0][1]}".`,
        );
      }

      writeFileSync(page, html.replace(PRERENDER_ROOT, `${PRERENDER_ROOT}${resolved}`));
    },
  };
}

// Landing-only production build. Invoked exclusively via `--config`, so the
// `vite marketing` dev server never auto-loads it. Root = marketing so the
// index.html's absolute /landing-prototype/ asset URLs resolve.
export default defineConfig({
  root: marketingRoot,
  plugins: [copyRuntimeAssets(), prerenderShell()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        changelog: resolve(import.meta.dirname, "changelog/index.html"),
      },
    },
  },
});
