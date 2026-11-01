// `vitest/config` re-exports Vite's own `defineConfig` with the `test` key
// typed. Importing it from "vite" instead would make the `test` block below a
// type error, and dropping that block silently breaks 276 component tests.
import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { PRESET_CONTROLS_FILE } from "./scripts/preset-controls-bundle.mjs";

/**
 * Under vitest a component that imports a shared Base UI control would load it through Node,
 * where Base UI's CommonJS `require("react")` reaches the real React instead of Preact
 * (scripts/preset-controls-bundle.mjs says why). So a test run resolves every shared control to
 * the bundle that script builds with the aliases applied; the build and dev server never see it.
 */
const PRESET_CONTROL_FILE =
  /[\\/]src[\\/]ui[\\/]controls[\\/](badge|button|collapsible|dialog|dropdown-menu|field|input|kbd|label|popover|scroll-area|select|separator|sheet|switch|tabs|toggle|toggle-group|tooltip)\.tsx$/;
const presetControlsInTests: Plugin = {
  name: "deck-preset-controls-in-tests",
  enforce: "pre",
  apply: () => process.env.VITEST === "true",
  async resolveId(source, importer, options) {
    if (importer === undefined || !source.startsWith(".")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved !== null && PRESET_CONTROL_FILE.test(resolved.id) ? PRESET_CONTROLS_FILE : null;
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Tailwind compiles only a stylesheet that imports it (`src/ui/preset.css`); `styles.css`
  // and its partials pass through untouched. The `@` alias is the one the shadcn CLI writes
  // into generated imports (`components.json`).
  plugins: [presetControlsInTests, preact(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Relative asset paths: Electron loads index.html over file://, where the
  // default absolute "/assets/..." resolves to the filesystem root, 404s, and
  // produces a blank window with nothing on stderr.
  base: "./",
  build: {
    // esbuild 0.25 mis-minifies xterm 6's function-local enum in
    // InputHandler.requestMode: it drops the declaration but leaves a renamed
    // reference behind (`ReferenceError: s is not defined`). OpenTUI sends a
    // DECRQM query at startup, so that exception permanently stops xterm's
    // write queue and leaves OpenCode running behind a blank pane. Terser
    // preserves the local binding and produces an equally compact bundle.
    minify: "terser",
  },
  test: {
    // Bundles the Base UI controls once per run, with the React aliases applied, for the
    // tests to import; Node would otherwise resolve Base UI's CommonJS `require("react")`
    // to the real React (scripts/preset-controls-bundle.mjs).
    globalSetup: ["./scripts/preset-controls-bundle.mjs"],
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
  // `electron:dev` runs this server in the same terminal as the main process;
  // clearing the screen would wipe its logs.
  clearScreen: false,
  // `scripts/electron-dev-watch.mjs` loads the renderer from this fixed port,
  // so a busy port must fail rather than drift.
  server: {
    port: 1420,
    strictPort: true,
  },
}));
