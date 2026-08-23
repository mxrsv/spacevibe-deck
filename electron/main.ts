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
import { BrowserPanels } from "./browser/view";
import { WindowCoordinator, type AdoptionPayload } from "./coordinator";
import { PtyManager } from "./pty/manager";
import { ptyInfo, type PtyInfo } from "./pty/info";
import { validateAgentProcessMatchers } from "./platform/classify";
import { censusFor, CloseFlight, QuitFlight } from "./quit-flow";
import { MAIN_LABEL, WindowRegistry } from "./window-lifecycle";
import { StoreRegistry } from "./store";
import { createWatchRegistry } from "./fs/watch";
import { MainDirtyRegistry } from "./dirty-registry";
import { createMenuState } from "./menu-state";
import { registerSettingsIpc } from "./settings-ipc";
import { registerServices } from "./ipc/register-services";
import { registerThemes } from "./ipc/register-themes";
import { registerExplorer } from "./ipc/register-explorer";
import { registerStore } from "./ipc/register-store";
import { registerDialogs } from "./ipc/register-dialogs";
import { registerBrowser, reactGrabSource } from "./ipc/register-browser";
import { registerShell } from "./ipc/register-shell";
import { registerUpdater } from "./ipc/register-updater";

// __dirname is `dist-electron/electron`, so the Vite output is two levels up.
const RENDERER_DIR = path.join(__dirname, "..", "..", "dist");

// Set by `scripts/electron-dev-watch.mjs`: when present, windows load the
// Vite dev server instead of the built renderer, so `electron:dev:watch` gets
// real renderer HMR without a full `npm run build` on every edit.
const DEV_SERVER_URL = process.env.DECK_DEV_SERVER_URL;
// `.cjs` — see scripts/build-electron-main.mjs for why the host is CommonJS.
const PRELOAD = path.join(__dirname, "preload.cjs");

/**
 * Packaged Monaco smoke: a regression proof that Monaco's editor, workers and
 * assets survive electron-builder, driven by
 * `scripts/verify-electron-monaco-smoke-package.mjs`. When the launcher sets
 * `DECK_MONACO_SMOKE=1`, the window loads the dedicated harness graph instead
 * of the application renderer, and renderer console lines are mirrored to
 * stdout so the verifier can wait for the harness's explicit ready signal.
 * Normal launches never read these variables;
 * `scripts/monaco-smoke-entry.test.ts` proves the harness graph stays out of
 * the shipping renderer.
 */
const MONACO_SMOKE = process.env.DECK_MONACO_SMOKE === "1";
const MONACO_SMOKE_RENDERER_DIR = path.join(__dirname, "..", "..", "dist-monaco-smoke-renderer");

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
 * Unsaved editor buffers, per window (file-explorer spec §6).
 *
 * Dirty state lives in the renderer's editor; the census lives here so a
 * wedged webview cannot make ⌘Q unanswerable. This registry is what keeps that
 * invariant true once files are editable — main still answers the census alone.
 * Empty today: the editor surface was left to the redesign, so nothing pushes
 * to it yet.
 */
const dirtyFiles = new MainDirtyRegistry();

/** `fs.watch` scopes, per window. Replaced wholesale on every renderer call. */
const watchers = createWatchRegistry((label, event) => {
  emitTo(label, EVENTS.fileChanged, event);
});

const browserPanels = new BrowserPanels({
  emit: emitTo,
  windowFor: (label) => windows.get(label),
  vendorSource: reactGrabSource,
  events: {
    state: EVENTS.browserState,
    grab: EVENTS.browserGrab,
    navigated: EVENTS.browserNavigated,
  },
});

const pty = new PtyManager({
  emitToOwner: (paneId, event, payload) => coordinator.deliver(paneId, event, payload),
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
    // The pre-render ground follows `--bg`'s default (`src/styles.css` :root,
    // `FALLBACK_BG` in theme-vars.ts), or window-open and resize flash a
    // colour the app never shows again. Tauri's window config carries the
    // same value for the same reason.
    backgroundColor: "#16161e",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windows.set(label, window);
  // Captured now, not in `closed`: the webContents is destroyed by then and
  // reading `.id` off it would throw inside the teardown handler.
  const senderId = window.webContents.id;

  // Deck is a single local document and must never navigate. A drop that the
  // renderer does not cancel, or any stray link, would otherwise load a new
  // document — and the preload re-injects `__deckHost` into it, handing the
  // whole host surface (spawn_shell, the stores, openExternal) to whatever
  // just loaded. Proven: the bridge survives navigation.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // A renderer that dies mid-recording never sends its `false`. Preact cleanup
  // does not run on a destroyed webview, so without this the accelerators stay
  // stripped for every window until relaunch.
  window.webContents.on("render-process-gone", () => {
    menuState.setRecording(senderId, false);
    // The window survives a dead renderer, so `closed` may never fire — but
    // the renderer that claimed the update-check flight is gone and will never
    // release it.
    updater.forgetWindow(label);
  });

  window.on("focus", () => {
    registry.recordFocus(label);
    // The submenu is ordered most-recently-focused first, so focus changing
    // changes its contents. Without this rebuild, Move Pane to Window keeps
    // reading "No other window" for the rest of the session after a detach.
    menuState.rebuildMenu();
  });

  window.on("close", (event) => {
    if (updater.isInstalling()) {
      // The installer is taking the app down. `quitAndInstall` closes every
      // window before `before-quit` ever fires, and the renderer already ran
      // this census with update copy (`confirmInstall` in `src/ui/app.tsx`)
      // and already killed the panes through `prepareForInstall`. Prompting
      // again would ask a question the user has answered and deadlock the
      // install behind it.
      return;
    }
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
    // Before `windows.delete`: closing the panel wants the window to still be
    // resolvable so the native view can be detached from its content view.
    browserPanels.close(label);
    windows.delete(label);
    // Same reason as `render-process-gone`: closing a window while one of its
    // Shortcuts rows is recording must not leave the app without accelerators.
    menuState.setRecording(senderId, false);
    registry.forgetWindow(label);
    quitFlight.forgetWindow(label);
    closeFlight.forget(label);
    // Same reason as the two flights above: a window that dies holding the
    // update-check flight would otherwise tell every peer that a check is in
    // progress for the rest of the process, and the automatic check would stop
    // happening with nothing said.
    updater.forgetWindow(label);
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
    menuState.rebuildMenu();
  });

  if (MONACO_SMOKE) {
    window.webContents.on("console-message", (event) => {
      process.stdout.write(`[monaco-smoke renderer] ${event.message}\n`);
    });
    void window.loadFile(path.join(MONACO_SMOKE_RENDERER_DIR, "monaco-smoke.html"), {
      query: { file: process.env.DECK_MONACO_SMOKE_FILE ?? "" },
    });
  } else if (DEV_SERVER_URL !== undefined) {
    void window.loadURL(DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(RENDERER_DIR, "index.html"));
  }
  registry.recordFocus(label);
  // A new window is a new move-pane target for every existing window.
  menuState.rebuildMenu();
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
async function censusOrDeny(paneIds: readonly number[]): Promise<PtyInfo[] | null> {
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

const menuState = createMenuState({ registry, emitTo, focused: focusedLabel });

// ------------------------------------------------------------------ PTY
ipcMain.handle(CHANNELS.spawnShell, (event, { cols, rows, cwd }) =>
  pty.spawn(labelOf(event), { cols, rows, cwd: cwd ?? null }),
);
ipcMain.handle(CHANNELS.writePty, (event, { id, data }) => pty.write(labelOf(event), id, data));
ipcMain.handle(CHANNELS.resizePty, (event, { id, cols, rows }) =>
  pty.resize(labelOf(event), id, cols, rows),
);
ipcMain.handle(CHANNELS.killPty, (event, { id }) => pty.kill(labelOf(event), id));
ipcMain.handle(CHANNELS.ptyInfo, (_event, { ids, agents, waitForCwd }) =>
  ptyInfo(pty.snapshots(ids), validateAgentProcessMatchers(agents), waitForCwd !== false),
);

// -------------------------------------------------------------- Services
registerServices({ labelOf, setRecording: menuState.setRecording });

// --------------------------------------------------------- Themes folder
registerThemes();

// ---------------------------------------------------------- File explorer
registerExplorer({ labelOf, watchers, dirtyFiles });

registerSettingsIpc({
  stores,
  windows,
  emitTo,
  adoptMenuKeymap: menuState.adoptMenuKeymap,
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
ipcMain.handle(CHANNELS.abortTransfer, (_event, { token }) => coordinator.abort(token));
ipcMain.handle(CHANNELS.windowBootMode, (event) => registry.bootMode(labelOf(event)));

/**
 * Open a window to receive a transferred pane.
 *
 * The three arguments are taken FLAT, not wrapped in a struct. On Tauri that
 * was a real shipped bug — the command declared one `args` parameter while the
 * frontend sent flat keys, and every gate stayed green because none of them
 * crossed the IPC boundary. The contract is frozen in that shape; do not fold
 * these back into an object.
 */
ipcMain.handle(CHANNELS.openPaneWindow, (_event, payload) => {
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
});

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
const updater = registerUpdater({
  labelOf,
  // The same order `confirm_quit` uses below. An install exit skips that
  // handler entirely, so without this the PTYs would die with the process and
  // the debounced stores would never reach disk.
  prepareForInstall: async () => {
    await pty.killAll();
    await stores.saveAll();
  },
});

registerStore({ stores, windows, emitTo });

registerDialogs();

registerBrowser({ labelOf, browserPanels });

registerShell();

// ------------------------------------------------------- Windows identity
// Both of these are no-ops away from Windows, and both are load-bearing on it.
//
// Without the AppUserModelID, a toast attributes itself to "Electron" and
// taskbar entries do not group — and `notification_send` is how an agent tells
// the user it is waiting for them, so the notification that matters most is
// the one wearing the wrong name.
//
// Without the single-instance lock, launching Deck twice yields two processes
// sharing one `userData`: `settings.json` and `workspaces.json` become
// last-writer-wins between them, and the session journal — which mirrors every
// window's live tabs — is written by both.
app.setAppUserModelId("dev.spacevibe.deck.electron");
if (!app.requestSingleInstanceLock()) {
  // A second launch hands its argv to the first instance and leaves. Quitting
  // before `whenReady` means no window, no PTY and no store was ever opened
  // here, so there is nothing to tear down.
  app.quit();
}
app.on("second-instance", () => {
  // The user asked for Deck and Windows gave them the running copy: surface it
  // rather than doing nothing, which reads as a failed launch.
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing !== undefined) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.focus();
  }
});

// ------------------------------------------------------------------ Boot
app.whenReady().then(() => {
  // Read the stored rebinds BEFORE the first window exists. `createWindow`
  // rebuilds the menu itself, so resolving afterwards would install the
  // shipped accelerators first and correct them a moment later — a window in
  // which the OS still eats the chord the user reassigned.
  void stores
    .open("settings.json")
    .then((store) => menuState.adoptMenuKeymap(store.get("settings")))
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
  if (updater.isInstalling()) {
    // Same reason as the window-close guard above: this quit IS the install,
    // and it was already confirmed in the renderer.
    return;
  }
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
    if (!emitTo(label, EVENTS.quitRequested, censusFor(requestId, infos, dirtyFiles.all()))) {
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
