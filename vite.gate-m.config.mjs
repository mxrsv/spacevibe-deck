import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

/**
 * Gate M renderer build (file-explorer plan §5.0.3).
 *
 * A dedicated config so the harness graph can exist without touching the
 * shipping build: `vite build` still walks only `index.html`, and this config
 * walks only `gate-m.html`, writing to its own output directory that only
 * `electron-builder.gate-m.yml` packages. `base: "./"` and Terser for the
 * same reasons as vite.config.ts — the page loads over `file://` from a
 * packaged app, and esbuild 0.25 mis-minifies xterm 6's requestMode enum.
 */
export default defineConfig({
  plugins: [preact()],
  base: "./",
  build: {
    outDir: "dist-gate-m-renderer",
    minify: "terser",
    rollupOptions: {
      input: "gate-m.html",
    },
  },
});
