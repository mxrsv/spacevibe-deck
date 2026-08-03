import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [preact()],
  build: {
    // esbuild 0.25 mis-minifies xterm 6's function-local enum in
    // InputHandler.requestMode: it drops the declaration but leaves a renamed
    // reference behind (`ReferenceError: s is not defined`). OpenTUI sends a
    // DECRQM query at startup, so that exception permanently stops xterm's
    // write queue and leaves OpenCode running behind a blank pane. Terser
    // preserves the local binding and produces an equally compact bundle.
    minify: "terser",
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
