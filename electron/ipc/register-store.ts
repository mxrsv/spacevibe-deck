/**
 * `store_*` IPC handlers: the renderer's key/value persistence facade over
 * `StoreRegistry`, plus the file-name allowlist that keeps a store path
 * inside the app's own data directory.
 */
import { ipcMain, type BrowserWindow } from "electron";
import { validateStorePatch, type StoreRegistry } from "../store";
import { EVENTS } from "./channels";

export interface RegisterStoreDeps {
  readonly stores: StoreRegistry;
  readonly windows: ReadonlyMap<string, BrowserWindow>;
  readonly emitTo: (label: string, event: string, payload: unknown) => boolean;
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
  // The repository rail's collapse state, and nothing else — the worktree
  // list itself is re-read every launch and never written down.
  "repositories.json",
  // Session journal: live window records + per-workspace archive (restore).
  "session.json",
]);
const SESSION_STORE = "session.json";
const SESSION_LABELS_KEY = "windowLabels";
const WINDOW_RECORD_PREFIX = "window:";

function assertStoreFile(file: unknown): string {
  if (typeof file !== "string" || !STORE_FILES.has(file)) {
    throw new Error(`Unknown store file: ${String(file)}`);
  }
  return file;
}

export function registerStore(deps: RegisterStoreDeps): void {
  const openStores = new Map<string, Awaited<ReturnType<StoreRegistry["open"]>>>();

  ipcMain.handle("store_load", async (_event, payload) => {
    const {
      file: rawFile,
      defaults,
      autoSave,
    } = payload as {
      file: string;
      defaults?: Record<string, unknown>;
      autoSave?: number;
    };
    const file = assertStoreFile(rawFile);
    const store = await deps.stores.open(file, {
      autoSaveMs: Number(autoSave) || 0,
    });
    // Broadcast the failure rather than replying to the window that happened to
    // open the file first. That window can be closed while others keep working,
    // and its `labelOf` would then THROW inside a rejection handler — an
    // unhandled rejection in the main process instead of a persist-error bar.
    await deps.stores.setErrorReporter(file, () => {
      for (const [label] of deps.windows) {
        deps.emitTo(label, EVENTS.storeWriteFailed, { file });
      }
    });
    if (file === "settings.json") {
      store.requireObjectValue("settings");
    }
    // `defaults` seeds keys the file does not have yet, matching the Tauri
    // plugin — without it a fresh install reads undefined where it expected a
    // default and silently falls back to a different value. An unreadable file
    // is never seeded: defaults are not evidence that its bytes may be replaced.
    if (store.loadState.state === "ready") {
      for (const [key, value] of Object.entries(defaults ?? {})) {
        if (store.get(key) === undefined) {
          store.set(key, value);
        }
      }
    }
    openStores.set(file, store);
    return store.loadState;
  });
  ipcMain.handle("store_get", (_event, { file, key }) => {
    const store = openStores.get(assertStoreFile(file));
    if (file === SESSION_STORE && key === SESSION_LABELS_KEY && store !== undefined) {
      // Derive the index from the records in this one main-process snapshot.
      // Renderer read/modify/write of a shared array lost concurrent windows;
      // ignoring that legacy array also recovers records it already omitted.
      return Object.keys(store.entries())
        .filter((entry) => entry.startsWith(WINDOW_RECORD_PREFIX))
        .map((entry) => entry.slice(WINDOW_RECORD_PREFIX.length))
        .filter((label) => label !== "");
    }
    return store?.get(key);
  });
  ipcMain.handle("store_set", (_event, { file, key, value }) => {
    openStores.get(assertStoreFile(file))?.set(key, value);
  });
  ipcMain.handle("store_delete", (_event, { file, key }) => {
    openStores.get(assertStoreFile(file))?.delete(key);
  });
  ipcMain.handle("store_patch", (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("Invalid store patch payload");
    }
    const { file: rawFile, values, deleteKeys } = payload as Record<string, unknown>;
    const file = assertStoreFile(rawFile);
    const store = openStores.get(file);
    if (store === undefined) throw new Error("Store has not been loaded");
    const patch = validateStorePatch(values, deleteKeys);
    // A boot snapshot may name a detached label that has since been reused.
    // Consuming that old source must not erase the new live window's journal.
    const removable = patch.deleteKeys.filter(
      (key) =>
        file !== SESSION_STORE ||
        !key.startsWith(WINDOW_RECORD_PREFIX) ||
        !deps.windows.has(key.slice(WINDOW_RECORD_PREFIX.length)),
    );
    return store.patch(patch.values, removable);
  });
  ipcMain.handle("store_save", (_event, { file }) => openStores.get(assertStoreFile(file))?.save());
}
