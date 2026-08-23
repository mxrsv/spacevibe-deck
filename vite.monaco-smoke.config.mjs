import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

/**
 * Packaged Monaco smoke renderer build.
 *
 * A dedicated config so the harness graph can exist without touching the
 * shipping build: `vite build` still walks only `index.html`, and this config
 * walks only `monaco-smoke.html`, writing to its own output directory that only
 * `electron-builder.monaco-smoke.yml` packages. `base: "./"` and Terser for the
 * same reasons as vite.config.ts — the page loads over `file://` from a
 * packaged app, and esbuild 0.25 mis-minifies xterm 6's requestMode enum.
 */
export default defineConfig({
  plugins: [preact()],
  base: "./",
  build: {
    outDir: "dist-monaco-smoke-renderer",
    minify: "terser",
    rollupOptions: {
      input: "monaco-smoke.html",
    },
  },
});
