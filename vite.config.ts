// `vitest/config` re-exports Vite's own `defineConfig` with the `test` key
// typed. Importing it from "vite" instead would make the `test` block below a
// type error, and dropping that block silently breaks 276 component tests.
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [preact()],
  // Relative asset paths: Electron loads index.html over file://, where the
  // default absolute "/assets/..." resolves to the filesystem root, 404s, and
  // produces a blank window with nothing on stderr.
  base: './',
  build: {
    // esbuild 0.25 mis-minifies xterm 6's function-local enum in
    // InputHandler.requestMode: it drops the declaration but leaves a renamed
    // reference behind (`ReferenceError: s is not defined`). OpenTUI sends a
    // DECRQM query at startup, so that exception permanently stops xterm's
    // write queue and leaves OpenCode running behind a blank pane. Terser
    // preserves the local binding and produces an equally compact bundle.
    minify: 'terser',
  },
  test: {
    server: {
      deps: {
        // `@preact/preset-vite` aliases react -> preact/compat through
        // `resolve.alias`, which only applies to modules Vite TRANSFORMS.
        // Vitest externalizes node_modules by default, so Phosphor's own
        // `import * as o from "react"` escaped the alias and resolved to the
        // real React 19 that npm auto-installs as its peer. React's
        // `forwardRef` returns an object, Preact sends a non-function vnode
        // type straight to `document.createElement`, and every component test
        // that draws an icon died with
        // `InvalidCharacterError: "[object Object]" did not match the QName
        // production`. Inlining the package puts it back through the
        // transform pipeline, where the alias reaches it.
        inline: [/@phosphor-icons\/react/],
      },
    },
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
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
