/**
 * Electron main process — the host.
 *
 * Everything the renderer cannot do itself lives here: PTYs, the process
 * table, persistent stores, windows, quit. The renderer reaches it only
 * through `ipcMain.handle` channels whose names are IDENTICAL to the Tauri
 * build's commands, so the renderer's call sites and its tests did not have to
 * change with the host.
 *
 * Two rules this file exists to keep:
 *  - The quit/close census is computed HERE, from live PTY state, so a wedged
 *    webview cannot make quit unanswerable.
 *  - Every pane command validates ownership through the coordinator before it
 *    touches a session.
 */
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { CHANNELS, EVENTS } from "./ipc/channels";
import { WindowCoordinator, type AdoptionPayload } from "./coordinator";
import { PtyManager } from "./pty/manager";
import { ptyInfo, type PtyInfo } from "./pty/info";
import { censusFor, CloseFlight, QuitFlight } from "./quit-flow";
import { MAIN_LABEL, WindowRegistry } from "./window-lifecycle";
import { StoreRegistry } from "./store";
import { detectAgentsSafely, dirsExist } from "./agents";
import { gitBranch } from "./git";
import { resolvePaths, openEditor } from "./links";
import { listPromptAssets } from "./prompt-assets";
import { readImageAsDataUrl, scanWorkspaceFavicon } from "./images";
import { applySettingsPatch } from "./settings-merge";
import { listDir, readFile, statFiles } from "./fs/read";
import { writeTextFile } from "./fs/write";
import { createWatchRegistry } from "./fs/watch";
import { MainDirtyRegistry } from "./dirty-registry";
import { buildMenu } from "./menu";
import {
  MACOS_KEYMAP,
  type KeyBinding,
} from "../src/terminal/action-registry";
import { resolveKeymap, validateKeybindings } from "../src/lib/keybindings";

// __dirname is `dist-electron/electron`, so the Vite output is two levels up.
const RENDERER_DIR = path.join(__dirname, "..", "..", "dist");
// `.cjs` — see scripts/build-electron-main.mjs for why the host is CommonJS.
const PRELOAD = path.join(__dirname, "preload.cjs");

const windows = new Map<string, BrowserWindow>();
const registry = new WindowRegistry();
const quitFlight = new QuitFlight();
// Per-window, separate from the app-wide quit prompt: two windows may prompt
// at the same time, and each guards only its own panes.
const closeFlight = new CloseFlight();
const stores = new StoreRegistry(app.getPath("userData"));

/**
 * Emit to one window by label. Returns false when there was no live window to
 * receive it.
 *
 * The return value matters for the quit and close prompts: Rust released its
 * flight when `emit_to` failed, and swallowing that here means a prompt nobody
 * can answer holds the flight for the rest of the process — an app that can
 * only be force-quit.
 */
function emitTo(label: string, event: string, payload: unknown): boolean {
  const window = windows.get(label);
  if (window === undefined || window.isDestroyed()) {
    return false;
  }
  window.webContents.send(event, payload);
  return true;
}

const coordinator = new WindowCoordinator(emitTo);

/**
 * Unsaved editor buffers, per window (spec §6).
 *
 * Dirty state lives in Monaco, in the renderer; the census lives here so a
 * wedged webview cannot make ⌘Q unanswerable. This registry is what keeps that
 * invariant true once files are editable — main still answers the census alone.
 */
const dirtyFiles = new MainDirtyRegistry();

/** `fs.watch` scopes, per window. Replaced wholesale on every renderer call. */
const watchers = createWatchRegistry((label, event) => {
  emitTo(label, EVENTS.fileChanged, event);
});

const pty = new PtyManager({
  emitToOwner: (paneId, event, payload) =>
    coordinator.deliver(paneId, event, payload),
  register: (paneId, label) => coordinator.register(paneId, label),
  unregister: (paneId) => coordinator.unregister(paneId),
  assertOwner: (paneId, label) => coordinator.assertAccess(paneId, label),
});

/** The label of the window that sent an IPC message. Every pane command needs
 * it, because ownership is per window. */
function labelOf(event: IpcMainInvokeEvent): string {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === null) {
    throw new Error("IPC from a window that no longer exists");
  }
  for (const [label, candidate] of windows) {
    if (candidate === window) {
      return label;
    }
  }
  throw new Error("IPC from an unregistered window");
}

function createWindow(label: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#101014",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windows.set(label, window);

  // Deck is a single local document and must never navigate. A drop that the
  // renderer does not cancel, or any stray link, would otherwise load a new
  // document — and the preload re-injects `__deckHost` into it, handing the
  // whole host surface (spawn_shell, the stores, openExternal) to whatever
  // just loaded. Proven: the bridge survives navigation.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.on("focus", () => {
    registry.recordFocus(label);
    // The submenu is ordered most-recently-focused first, so focus changing
    // changes its contents. Without this rebuild, Move Pane to Window keeps
    // reading "No other window" for the rest of the session after a detach.
    rebuildMenu();
  });

  window.on("close", (event) => {
    // Abort FIRST, census second. `window_close.rs` states the order is
    // load-bearing: a transfer left open across a close holds its pane frozen
    // until the timeout, and the guard would then run against a route nobody
    // owns. Running it unconditionally matters too — an idle window can still
    // be a transfer's source, and skipping the abort strands the pane.
    coordinator.abortInvolving(label);
    for (const paneId of coordinator.takePendingOrphans()) {
      pty.terminate(paneId);
    }

    // ALWAYS route the close through the renderer, even with nothing busy.
    // The renderer's guard flushes debounced state before it confirms
    // (`quit-guard.ts` `finish`), and an empty census is exactly the case it
    // auto-confirms — deciding "nothing busy, just close" here instead would
    // skip that flush and lose the user's last settings change.
    event.preventDefault();
    const requestId = closeFlight.tryBegin(label);
    if (requestId === null) {
      // This window's own prompt is already open. Leave it up rather than
      // opening a second one, and keep the window alive to carry it.
      return;
    }
    void (async () => {
      const infos = await censusOrDeny(coordinator.panesForWindow(label));
      if (infos === null) {
        // The reading failed, so nothing can be asserted about what is
        // running. Release the flight and leave the window open: refusing to
        // close is recoverable, killing an agent on a guess is not.
        closeFlight.take(label, requestId);
        return;
      }
      if (
        !emitTo(
          label,
          EVENTS.windowCloseRequested,
          // This window's unsaved files only. Closing one window must not name
          // another's, and the pane census is already scoped the same way.
          censusFor(requestId, infos, dirtyFiles.forWindow(label)),
        )
      ) {
        // Nobody can answer the prompt — a wedged or gone webview. Release
        // the flight so the next attempt is not swallowed silently.
        closeFlight.take(label, requestId);
      }
    })();
  });

  window.on("closed", () => {
    windows.delete(label);
    registry.forgetWindow(label);
    quitFlight.forgetWindow(label);
    closeFlight.forget(label);
    // Same reason the pane routes are cleared right here: a renderer that dies
    // mid-edit would otherwise leave main permanently believing a file is
    // unsaved, and ⌘Q would ask about a window that no longer exists.
    dirtyFiles.forgetWindow(label);
    watchers.forgetWindow(label);
    // Crash path: no close event fired and no busy guard ran, so the panes this
    // window still owned would otherwise outlive it with nobody reading them.
    for (const paneId of coordinator.handleWindowDestroyed(label)) {
      pty.terminate(paneId);
    }
    rebuildMenu();
  });

  void window.loadFile(path.join(RENDERER_DIR, "index.html"));
  registry.recordFocus(label);
  // A new window is a new move-pane target for every existing window.
  rebuildMenu();
  return window;
}

/**
 * The census for a set of panes, or null when the process table could not be
 * read.
 *
 * Null is NOT "nothing is busy". A failed reading classifies every pane
 * `unknown`, and `unknown` is not `busy`, so treating it as an empty census
 * would silently kill running agents with no prompt — the exact failure this
 * subsystem exists to prevent.
 */
async function censusOrDeny(
  paneIds: readonly number[],
): Promise<PtyInfo[] | null> {
  try {
    return await ptyInfo(pty.snapshots(paneIds));
  } catch (error) {
    console.error("Deck: cannot read the process table; refusing to act", error);
    return null;
  }
}

function focusedLabel(): string | null {
  return registry.order()[0] ?? null;
}

/**
 * The macOS keymap the menu advertises: shipped defaults plus whatever the
 * user rebound. Held here rather than resolved per rebuild because
 * `rebuildMenu` runs on every focus change, and re-reading the store on each
 * one would put a disk read on the focus path.
 */
let menuKeymap: readonly KeyBinding[] = MACOS_KEYMAP;

/** True while a Shortcuts row is recording — see `MenuDeps.suspendAccelerators`. */
let acceleratorsSuspended = false;

/** Re-resolve the menu keymap from a settings object and rebuild if it moved. */
function adoptMenuKeymap(settings: unknown): void {
  const overrides = validateKeybindings(
    (settings as { keybindings?: unknown } | null)?.keybindings,
  );
  const next = resolveKeymap("macos", overrides);
  menuKeymap = next;
  rebuildMenu();
}

/** Rebuild the application menu. Called on boot, and on every window open,
 * focus change and close — the move-pane submenu lists peer windows, so its
 * contents change with all three. */
function rebuildMenu(): void {
  buildMenu({
    registry,
    emitTo,
    focused: () => focusedLabel(),
    keymap: menuKeymap,
    suspendAccelerators: acceleratorsSuspended,
  });
}

// ------------------------------------------------------------------ PTY
ipcMain.handle(CHANNELS.spawnShell, (event, { cols, rows, cwd }) =>
  pty.spawn(labelOf(event), { cols, rows, cwd: cwd ?? null }),
);
ipcMain.handle(CHANNELS.writePty, (event, { id, data }) =>
  pty.write(labelOf(event), id, data),
);
ipcMain.handle(CHANNELS.resizePty, (event, { id, cols, rows }) =>
  pty.resize(labelOf(event), id, cols, rows),
);
ipcMain.handle(CHANNELS.killPty, (event, { id }) =>
  pty.kill(labelOf(event), id),
);
ipcMain.handle(CHANNELS.ptyInfo, (_event, { ids }) =>
  ptyInfo(pty.snapshots(ids)),
);

// -------------------------------------------------------------- Services
ipcMain.handle(CHANNELS.gitBranch, (_event, { cwd }) => gitBranch(cwd));
ipcMain.handle(CHANNELS.detectAgents, (_event, { names }) =>
  detectAgentsSafely(names ?? []),
);
ipcMain.handle(CHANNELS.dirsExist, (_event, { paths }) => dirsExist(paths));
ipcMain.handle(CHANNELS.desktopEnvironment, () => ({
  // `homeDir`, not `home`: Rust's struct is `#[serde(rename_all = "camelCase")]`
  // so that has always been the wire key. `platform.ts` rejects anything else,
  // the caller swallows the error, and the app silently falls back to
  // `platform: "unsupported"` — where `hasPrimaryModifier` returns false for
  // every event and EVERY keyboard shortcut stops working, with nothing in the
  // console to say why.
  platform:
    process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : "unsupported",
  homeDir: app.getPath("home"),
}));
ipcMain.handle(CHANNELS.resolvePaths, (_event, { cwd, paths }) =>
  resolvePaths(cwd, paths),
);
ipcMain.handle(CHANNELS.openEditor, (_event, { request }) =>
  // Destructured: the renderer wraps the payload in `{ request }` to match the
  // Rust parameter name, so taking the payload whole read `.editor` off the
  // wrapper and every file link failed as "editor not supported".
  openEditor(request),
);
ipcMain.handle(CHANNELS.listPromptAssets, (_event, { agent, cwd }) =>
  listPromptAssets(agent, cwd ?? null),
);
ipcMain.handle(CHANNELS.readImageAsDataUrl, (_event, { path: target }) =>
  readImageAsDataUrl(target),
);
ipcMain.handle(CHANNELS.scanWorkspaceFavicon, (_event, { dir }) =>
  scanWorkspaceFavicon(dir),
);
ipcMain.handle(CHANNELS.suspendMenuAccelerators, (_event, { suspended }) => {
  const next = suspended === true;
  if (next === acceleratorsSuspended) {
    return;
  }
  acceleratorsSuspended = next;
  rebuildMenu();
});

// ---------------------------------------------------------- File explorer
// Every path is bounded to the workspace root by `fs/path-guard.ts`. `root`
// travels with each call rather than being remembered per window: a tab fixes
// its workspace at Open and a second window may hold a different one, so a
// cached root would authorize the wrong tree.
ipcMain.handle(CHANNELS.listDir, (_event, { root, directory }) =>
  listDir(root, directory),
);
ipcMain.handle(CHANNELS.readFile, (_event, { root, path: target }) =>
  readFile(root, target),
);
ipcMain.handle(
  CHANNELS.writeFile,
  (_event, { root, path: target, text, eol }) =>
    writeTextFile(root, target, text, eol),
);
ipcMain.handle(CHANNELS.statFiles, (_event, { root, paths }) =>
  statFiles(root, paths),
);
ipcMain.handle(CHANNELS.watchPaths, (event, { root, directories, files }) => {
  // A REPLACE. Adding would let a collapsed directory leak a watcher for the
  // rest of the window's life.
  watchers.replace(labelOf(event), { root, directories, files });
});
ipcMain.handle(CHANNELS.setDirtyFiles, (event, { paths }) => {
  dirtyFiles.replace(labelOf(event), Array.isArray(paths) ? paths : []);
});

ipcMain.handle(CHANNELS.applySettingsPatch, async (_event, { patch }) => {
  const merged = await applySettingsPatch(stores, patch);
  // A rebind has to reach the native menu in the same turn it reaches the
  // store. Until it does, Cocoa still owns the old chord and eats it before
  // any window sees the keydown — the rebind would look applied everywhere
  // except where it matters.
  adoptMenuKeymap(merged);
  // EVERY window, sender included. `settings-store.ts` states that the
  // broadcast is the one authoritative path and that the reply is used only to
  // detect failure — so excluding the sender left it rendering stale settings
  // until relaunch. Resolving the sender's label after the await was also a
  // latent throw: a window closed during the disk write has no label.
  for (const [label] of windows) {
    emitTo(label, EVENTS.settingsMerged, merged);
  }
  return merged;
});

// ------------------------------------------------------------------ Quit
ipcMain.handle(CHANNELS.confirmQuit, (_event, { requestId }) => {
  if (!quitFlight.finish(requestId)) {
    return;
  }
  void pty
    .killAll()
    .then(() => stores.saveAll())
    .finally(() => app.exit(0));
});
ipcMain.handle(CHANNELS.cancelQuit, (_event, { requestId }) => {
  quitFlight.finish(requestId);
});
ipcMain.handle(CHANNELS.confirmCloseWindow, (event, { requestId }) => {
  const label = labelOf(event);
  // Checked against the WINDOW as well as the id: close and quit ids come from
  // different counters now, and a reply from an earlier close attempt must not
  // destroy a window the user chose to keep.
  if (!closeFlight.take(label, requestId)) {
    return;
  }
  for (const paneId of coordinator.panesForWindow(label)) {
    pty.terminate(paneId);
  }
  windows.get(label)?.destroy();
});
ipcMain.handle(CHANNELS.cancelCloseWindow, (event, { requestId }) => {
  closeFlight.take(labelOf(event), requestId);
});

// ------------------------------------------------------------- Transfers
ipcMain.handle(CHANNELS.prepareTransfer, (event, { paneId }) =>
  // `paneId` arrives as a STRING — a frozen contract the renderer documents at
  // its call site — while routes are keyed by number. Without this coercion
  // every detach failed instantly with "Pane #N is not registered", and
  // TypeScript could not see it because an IPC payload is `any`.
  coordinator.beginTransfer(labelOf(event), Number(paneId)),
);
ipcMain.handle(
  CHANNELS.stageTransfer,
  (event, { token, payload }: { token: string; payload: AdoptionPayload }) =>
    coordinator.stagePayload(token, labelOf(event), payload),
);
ipcMain.handle(CHANNELS.claimTransfer, (event, { token }) =>
  coordinator.claim(token, labelOf(event)),
);
ipcMain.handle(CHANNELS.commitTransfer, (event, { token }) =>
  coordinator.commit(token, labelOf(event)),
);
ipcMain.handle(CHANNELS.abortTransfer, (_event, { token }) =>
  coordinator.abort(token),
);
ipcMain.handle(CHANNELS.focusOrder, (event) => registry.order(labelOf(event)));
ipcMain.handle(CHANNELS.windowBootMode, (event) =>
  registry.bootMode(labelOf(event)),
);

/**
 * Open a window to receive a transferred pane.
 *
 * The three arguments are taken FLAT, not wrapped in a struct. On Tauri that
 * was a real shipped bug — the command declared one `args` parameter while the
 * frontend sent flat keys, and every gate stayed green because none of them
 * crossed the IPC boundary. The contract is frozen in that shape; do not fold
 * these back into an object.
 */
ipcMain.handle(
  CHANNELS.openPaneWindow,
  (_event, payload) => {
    // Flat arguments, never a wrapper object — the frozen contract. Optional
    // keys are read off the payload rather than destructured in the signature
    // so the contract test does not read them as required.
    const { token, screenX, screenY } = payload as {
      token: string;
      screenX?: number;
      screenY?: number;
    };
    const label = registry.allocateLabel();
    registry.reserveAdoption(label, token);
    coordinator.reserveDestination(token, label);
    const window = createWindow(label);
    if (screenX !== undefined && screenY !== undefined) {
      window.setPosition(Math.round(screenX), Math.round(screenY));
    }
    return label;
  },
);

// `targetLabel`, not `label`: this is the frozen wire contract (camelCase of
// Rust's `target_label`) and the renderer already sends it. Caught by
// `scripts/electron-ipc-contract.test.ts` on its first run — the same class of
// mismatch that shipped `open_pane_window`.
ipcMain.handle(CHANNELS.offerTransfer, (_event, { token, targetLabel }) => {
  if (!windows.has(targetLabel)) {
    // Must fail loudly: after staging, `transfer:settled` is the source's only
    // signal, and a silent success would leave it waiting for the timeout.
    throw new Error(`Window ${targetLabel} no longer exists`);
  }
  coordinator.reserveDestination(token, targetLabel);
  emitTo(targetLabel, EVENTS.transferOffer, { token });
});

// --------------------------------------------------------------- Updater
// Gate A: no Apple Developer identity exists yet, so `electron-updater` cannot
// be proven end to end on macOS (Squirrel.Mac refuses an app that is not
// Developer ID signed and notarized). The single-flight is kept so the
// renderer's controller behaves identically; the check itself is a stub.
let updateInFlight = false;
ipcMain.handle(CHANNELS.beginUpdateCheck, () => {
  if (updateInFlight) {
    return false;
  }
  updateInFlight = true;
  return true;
});
ipcMain.handle(CHANNELS.endUpdateCheck, () => {
  updateInFlight = false;
});

// ----------------------------------------------------- Renderer facades
// These back `src/host/*`. They are not Tauri command names because Tauri had
// no equivalent — each was a plugin call in the renderer. Naming them here
// keeps every host call on one wire with one contract.
const openStores = new Map<string, Awaited<ReturnType<StoreRegistry["open"]>>>();

interface DialogPayload {
  readonly message: string;
  readonly title?: string;
  readonly kind?: "info" | "warning" | "error";
  readonly okLabel?: string;
  readonly cancelLabel?: string;
}

interface OpenDialogPayload {
  readonly directory?: boolean;
  readonly multiple?: boolean;
  readonly title?: string;
  readonly filters?: Array<{ name: string; extensions: string[] }>;
}

/**
 * The store files Deck owns. An allowlist, because `file` reaches
 * `path.join(userData, file)` and `../../../` escaped it — writing arbitrary
 * JSON to an arbitrary path, and reading any JSON file back into the renderer.
 * Tauri had the same hole; it is nearly free to close here.
 */
const STORE_FILES = new Set([
  "settings.json",
  "workspaces.json",
  "presets.json",
  "logo.json",
  "workspace-logos.json",
  "update-attempt.json",
]);

function assertStoreFile(file: unknown): string {
  if (typeof file !== "string" || !STORE_FILES.has(file)) {
    throw new Error(`Unknown store file: ${String(file)}`);
  }
  return file;
}

ipcMain.handle("store_load", async (_event, payload) => {
  const { file: rawFile, defaults, autoSave } = payload as {
    file: string;
    defaults?: Record<string, unknown>;
    autoSave?: number;
  };
  const file = assertStoreFile(rawFile);
  const store = await stores.open(file, {
    autoSaveMs: Number(autoSave) || 0,
  });
  // Broadcast the failure rather than replying to the window that happened to
  // open the file first. That window can be closed while others keep working,
  // and its `labelOf` would then THROW inside a rejection handler — an
  // unhandled rejection in the main process instead of a persist-error bar.
  await stores.setErrorReporter(file, () => {
    for (const [label] of windows) {
      emitTo(label, "store:write-failed", { file });
    }
  });
  // `defaults` seeds keys the file does not have yet, matching the Tauri
  // plugin — without it a fresh install reads undefined where it expected a
  // default and silently falls back to a different value.
  for (const [key, value] of Object.entries(defaults ?? {})) {
    if (store.get(key) === undefined) {
      store.set(key, value);
    }
  }
  openStores.set(file, store);
});
ipcMain.handle("store_get", (_event, { file, key }) =>
  openStores.get(assertStoreFile(file))?.get(key),
);
ipcMain.handle("store_set", (_event, { file, key, value }) => {
  openStores.get(assertStoreFile(file))?.set(key, value);
});
ipcMain.handle("store_delete", (_event, { file, key }) => {
  openStores.get(assertStoreFile(file))?.delete(key);
});
ipcMain.handle("store_save", (_event, { file }) =>
  openStores.get(assertStoreFile(file))?.save(),
);

ipcMain.handle("dialog_ask", async (event, payload) => {
  const { message, title, kind, okLabel, cancelLabel } = payload as DialogPayload;
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showMessageBox(window!, {
    type: kind ?? "info",
    message: title ?? message,
    detail: title === undefined ? undefined : message,
    buttons: [okLabel ?? "OK", cancelLabel ?? "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  return result.response === 0;
});
ipcMain.handle("dialog_message", async (event, payload) => {
  const { message, title, kind } = payload as DialogPayload;
  const window = BrowserWindow.fromWebContents(event.sender);
  await dialog.showMessageBox(window!, {
    type: kind ?? "info",
    message: title ?? message,
    detail: title === undefined ? undefined : message,
    buttons: ["OK"],
  });
});
ipcMain.handle("dialog_open", async (event, payload) => {
  const { directory, multiple, title, filters } = payload as OpenDialogPayload;
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(window!, {
    title,
    filters,
    properties: [
      directory === true ? "openDirectory" : "openFile",
      ...(multiple === true ? (["multiSelections"] as const) : []),
    ],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("window_close", (event) =>
  BrowserWindow.fromWebContents(event.sender)?.close(),
);
ipcMain.handle("window_toggle_maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window === null) {
    return;
  }
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});
// No `window_is_focused` / `window_scale_factor` handlers: both are answered
// in the renderer from `document.hasFocus()` and `devicePixelRatio`. The
// main-process versions were worse — `getZoomFactor()` returns the user's ZOOM
// level, which is 1 on a 2x display at default zoom, so it silently turned the
// physical-to-logical drop conversion into a no-op.

/**
 * Schemes Deck will hand to the OS.
 *
 * Tauri enforced this in the HOST via the `opener:default` permission set;
 * dropping it left `shell.openExternal` open to anything the renderer passed,
 * and the renderer is not the trust boundary — an OSC 8 hyperlink carrying
 * `file:///Applications/…` was one renderer bug away from launching it.
 */
const OPENABLE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

ipcMain.handle("shell_open_url", (_event, { url }) => {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error("That link is not a valid URL.");
  }
  if (!OPENABLE_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Deck will not open ${parsed.protocol} links.`);
  }
  return shell.openExternal(parsed.href);
});
ipcMain.handle("clipboard_read_text", () => clipboard.readText());
ipcMain.handle("clipboard_write_text", (_event, { text }) =>
  clipboard.writeText(text),
);
// Electron needs no permission grant for notifications; answering true keeps
// the renderer's request/grant flow unchanged.
ipcMain.handle("notification_permission_granted", () =>
  Notification.isSupported(),
);
ipcMain.handle("notification_request_permission", () =>
  Notification.isSupported() ? "granted" : "denied",
);
ipcMain.handle("notification_send", (_event, payload) => {
  const { title, body } = payload as { title: string; body?: string };
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});
ipcMain.handle("app_relaunch", () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle("app_version", () => app.getVersion());

// ------------------------------------------------------------------ Boot
app.whenReady().then(() => {
  // Read the stored rebinds BEFORE the first window exists. `createWindow`
  // rebuilds the menu itself, so resolving afterwards would install the
  // shipped accelerators first and correct them a moment later — a window in
  // which the OS still eats the chord the user reassigned.
  void stores
    .open("settings.json")
    .then((store) => adoptMenuKeymap(store.get("settings")))
    .catch((error: unknown) => {
      // Defaults are already installed; an unreadable settings file must not
      // stop the app from booting with a working menu.
      console.warn("Deck: could not read stored keybindings", error);
    })
    .finally(() => {
      createWindow(MAIN_LABEL);
    });
});

app.on("before-quit", (event) => {
  const paneIds = coordinator.allPanes();
  // The dirty registry is part of this question, not an afterthought: a window
  // holding only file tabs owns NO panes, so `allPanes()` is empty and this
  // early return used to let ⌘Q exit with unsaved edits in the editor, silently
  // (plan §1 finding 4). Window close never had this hole — it prevents the
  // default unconditionally — so the two paths are fixed differently on
  // purpose.
  if (paneIds.length === 0 && !dirtyFiles.anyDirty()) {
    return;
  }
  // No window can answer, so there is nobody to prompt. Rust's `exit_policy`
  // allowed the exit outright in this case; preventing it here would leave an
  // app that can only be force-quit.
  const label = focusedLabel();
  if (label === null || !windows.has(label)) {
    void pty.killAll().finally(() => app.exit(0));
    event.preventDefault();
    return;
  }
  event.preventDefault();
  // Exactly one window is asked, behind the app-wide in-flight lock: a second
  // quit while the dialog is open must do nothing.
  const requestId = quitFlight.tryBegin(label);
  if (requestId === null) {
    return;
  }
  void (async () => {
    const infos = await censusOrDeny(paneIds);
    if (infos === null) {
      // Cannot establish what is running; do not quit on a guess.
      quitFlight.finish(requestId);
      return;
    }
    // Sent even when nothing is busy: the renderer auto-confirms a census that
    // is empty in BOTH dimensions, but only after flushing debounced state to
    // disk. Every window's unsaved files, deduplicated — quit ends them all.
    if (
      !emitTo(
        label,
        EVENTS.quitRequested,
        censusFor(requestId, infos, dirtyFiles.all()),
      )
    ) {
      quitFlight.finish(requestId);
    }
  })();
});

// The last window closing ends the app on Windows/Linux; on macOS Deck follows
// the platform convention only when the user actually quits.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS keeps the process alive with no windows, so clicking the dock icon has
// to be able to bring one back. Without this the app was unreachable after the
// last window closed and could only be force-quit.
app.on("activate", () => {
  if (windows.size === 0) {
    createWindow(MAIN_LABEL);
  }
});

export { clipboard, dialog, Notification, shell };
