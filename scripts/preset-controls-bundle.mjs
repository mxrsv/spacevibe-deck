// Test boundary for the Base UI controls under Preact (migration plan gate W0-T).
//
// Base UI imports `use-sync-external-store/shim/with-selector`, a CommonJS file that
// `require("react")`s. Vitest externalizes node_modules and loads CommonJS through Node,
// where the `react` -> `preact/compat` alias cannot reach, so the first overlay died with
// "Invalid hook call" against the real React 19 that Phosphor pulls in as a peer. Inlining
// Base UI does not help (a `require` is not transformed), and the dependency optimizer
// emits `import "react"` in its chunks and ignores `esbuildOptions.alias`.
//
// So the controls are bundled once per run with the same aliases the production build
// applies, and the tests import that bundle. Preact stays external: the bundle and the
// test file resolve `preact` to the same ESM instance, one hook state, and the bundle's
// metafile proves no module of real React went in.
import { build } from "esbuild";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT_DIR = join(ROOT, "node_modules/.cache/deck-tests");
export const PRESET_CONTROLS_FILE = join(OUT_DIR, "preset-controls.mjs");

/**
 * `use-sync-external-store` is CommonJS and calls `require("react")`. An external
 * `require` becomes `__require`, which an ES module cannot satisfy, and a CommonJS build of
 * Preact would be a second instance next to the ESM one the test file imports. This plugin
 * answers those calls with an ES module that re-exports `preact/compat`, so the require is
 * bundled as interop around one external ESM import.
 */
const requireReactAsCompat = {
  name: "require-react-as-preact-compat",
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => {
      if (args.kind !== "require-call") return undefined;
      const sub = args.path.replace(/^(react|react-dom)/, "");
      return { path: `preact/compat${sub}`, namespace: "compat-esm" };
    });
    build.onLoad({ filter: /.*/, namespace: "compat-esm" }, (args) => ({
      contents: `export * from "${args.path}";`,
      resolveDir: ROOT,
    }));
  },
};

/** A bundled module of the real React runtime. Preact's compat layer replaces both. */
export const REACT_RUNTIME = /node_modules[\\/](react|react-dom|scheduler)[\\/]/;

/**
 * @param {string} entry absolute path of the module to bundle
 * @param {string} outfile absolute path of the bundle to write
 * @param {{ alias?: Record<string, string> }} [options] `alias` replaces the default React
 *   aliases; the negative control passes none to prove the check below can fail.
 */
export async function bundleForPreact(entry, outfile, options = {}) {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    jsxImportSource: "preact",
    alias: options.alias ?? {
      "@": join(ROOT, "src"),
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
    external: ["preact", "preact/*"],
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: options.alias === undefined ? [requireReactAsCompat] : [],
    metafile: true,
    logLevel: "silent",
  });
  return Object.keys(result.metafile.inputs).filter((input) => REACT_RUNTIME.test(input));
}

export default async function setup(project) {
  mkdirSync(OUT_DIR, { recursive: true });
  // Built under a private name and renamed, so a second vitest run in this checkout never
  // reads a half-written bundle.
  const staging = `${PRESET_CONTROLS_FILE}.${process.pid}.tmp.mjs`;
  const leaked = await bundleForPreact(join(ROOT, "src/ui/controls/preset-controls.ts"), staging);
  renameSync(staging, PRESET_CONTROLS_FILE);
  if (leaked.length > 0) {
    throw new Error(`the controls bundle contains real React modules:\n${leaked.join("\n")}`);
  }
  project.provide("presetControlsUrl", pathToFileURL(PRESET_CONTROLS_FILE).href);
}
