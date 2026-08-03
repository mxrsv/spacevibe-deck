import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const marketingRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(import.meta.dirname, "dist");

// Files the page references by absolute URL string (not by import), so Rollup
// never sees them. Paths are relative to the marketing root and mirrored
// verbatim into dist. The deck-tour files are the hand-published render cut
// (see marketing/video/README.md).
const RUNTIME_ASSETS = [
  "landing-prototype/assets",
  "deck-tour.webm",
  "deck-tour.mp4",
  "deck-tour-poster.png",
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
    },
  };
}

// Landing-only production build. Invoked exclusively via `--config`, so the
// `vite marketing` dev server never auto-loads it. Root = marketing so the
// index.html's absolute /landing-prototype/ asset URLs resolve.
export default defineConfig({
  root: marketingRoot,
  plugins: [copyRuntimeAssets()],
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
