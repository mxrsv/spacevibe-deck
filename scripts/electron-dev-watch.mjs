// Hot-reload orchestrator for `npm run electron:dev:watch`.
//
// The renderer gets real HMR by having the Electron window load the Vite dev
// server directly (`electron/main.ts` reads `DECK_DEV_SERVER_URL`) instead of
// the built `dist/index.html`. Electron's own main process cannot hot-reload
// itself, so this watches `electron/` and the handful of `src/` directories
// it imports from, and on change reruns `electron:build` and relaunches the
// app — the same two steps `electron:dev` already runs once, just repeated
// on save instead of by hand.
//
// Relaunching hard-kills the running window (no IPC path exists from here
// into a separate OS process to trigger Deck's own dirty-file/busy-pane quit
// guard in `electron/main.ts`), so every save that touches watched files
// discards unsaved editor buffers and live PTY/agent sessions in that window.
// `killElectron()` warns when it actually does this.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The `electron` package's main export is the path to its executable — the
// standard way to invoke it without depending on node_modules/.bin being on
// PATH, which is only true when this script itself was launched via `npm run`.
import electronBin from "electron";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Fixed by `vite.config.ts` for the Tauri host too; Electron's window loads
// the same URL in dev mode.
const DEV_SERVER_URL = "http://localhost:1420";
const DEBOUNCE_MS = 200;
// `npm` resolves to `npm.cmd` on Windows, which `spawn()` cannot exec without
// a shell. Verified on macOS only — Windows path is untested.
const IS_WINDOWS = process.platform === "win32";

function spawnProcess(command, args, extraEnv, options) {
  return spawn(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    ...options,
  });
}

function runNpm(args) {
  return spawnProcess("npm", args, {}, { shell: IS_WINDOWS });
}

function runElectron() {
  return spawnProcess(
    electronBin,
    ["dist-electron/electron/main.cjs"],
    { DECK_DEV_SERVER_URL: DEV_SERVER_URL },
    {},
  );
}

/** Resolves once the dev server answers, or rejects if `viteChild` dies first. */
async function waitForDevServer(viteChild) {
  let died = null;
  const onDeath = (codeOrError) => {
    died = new Error(
      `vite dev server exited before it became ready: ${codeOrError}`,
    );
  };
  viteChild.once("exit", onDeath);
  viteChild.once("error", onDeath);
  try {
    for (;;) {
      if (died !== null) {
        throw died;
      }
      try {
        await fetch(DEV_SERVER_URL);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  } finally {
    viteChild.removeListener("exit", onDeath);
    viteChild.removeListener("error", onDeath);
  }
}

let electronChild = null;
let currentBuild = null;
let building = false;
let rebuildQueued = false;

function killElectron() {
  if (electronChild !== null && !electronChild.killed) {
    console.warn(
      "electron-dev-watch: relaunching — this hard-kills the running window, discarding unsaved editor buffers and any live PTY/agent sessions in it.",
    );
    electronChild.kill();
  }
  electronChild = null;
}

async function rebuildAndLaunch() {
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  // Build BEFORE killing the running window: a failed build leaves the
  // previous window open and usable, and the error message below stays true.
  currentBuild = runNpm(["run", "electron:build"]);
  const code = await new Promise((resolve) => currentBuild.on("exit", resolve));
  currentBuild = null;
  building = false;
  if (code === 0) {
    killElectron();
    electronChild = runElectron();
  } else {
    console.error(
      "electron-dev-watch: electron:build failed; the previous window is still open — fix the error and save again.",
    );
  }
  if (rebuildQueued) {
    rebuildQueued = false;
    void rebuildAndLaunch();
  }
}

let debounceTimer = null;
function scheduleRebuild(filename) {
  // Test files never reach the compiled main-process bundle.
  if (typeof filename === "string" && filename.endsWith(".test.ts")) {
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void rebuildAndLaunch(), DEBOUNCE_MS);
}

const vite = runNpm(["run", "dev"]);
// The exact `src/` directories `electron/**/*.ts` imports from today (menu
// keymap and platform helpers from `lib/`, the transfer client and action
// registry from `terminal/`, update-menu wiring from `updater/`, file-content
// helpers from `files/` — per `grep -rho '"(\.\./)+src/[a-z-]+/' electron/`).
// Narrower than all of `src/` so editing pure-renderer code (ui/, browser/,
// gallery/, ...) does not discard the running window on every save; if a
// future `electron/*.ts` starts importing a new top-level `src/` directory,
// add it here too.
const SRC_WATCH_DIRS = ["files", "lib", "terminal", "updater"];
const watchers = [
  watch(path.join(ROOT, "electron"), { recursive: true }, (_event, filename) =>
    scheduleRebuild(filename),
  ),
  ...SRC_WATCH_DIRS.map((dir) =>
    watch(
      path.join(ROOT, "src", dir),
      { recursive: true },
      (_event, filename) => scheduleRebuild(filename),
    ),
  ),
];

function shutdown() {
  for (const watcher of watchers) {
    watcher.close();
  }
  clearTimeout(debounceTimer);
  currentBuild?.kill();
  killElectron();
  vite.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await waitForDevServer(vite);
} catch (error) {
  console.error(`electron-dev-watch: ${error.message}`);
  process.exit(1);
}
await rebuildAndLaunch();
