import { signal } from "@preact/signals";
import { Store } from "../host/store-host";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  type DockTab,
  type Settings,
  type TerminalColors,
} from "./settings-schema";
import { reportPersistError } from "../chrome/events";
import { listen } from "../host/bridge";
import { createTauriSettingsSync, type SettingsSyncClient } from "./settings-sync";
import { LOAD_LOADING, LOAD_READY, loadError, type LoadState } from "../lib/load-state";

const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
const AUTOSAVE_DEBOUNCE_MS = 300;

export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const settingsLoadState = signal<LoadState>(LOAD_LOADING);

let store: Store | null = null;
let sync: SettingsSyncClient | null = null;
let loadGeneration = 0;
let mergedRevision = 0;
let settingsDegraded = false;
let syncListener: {
  readonly client: SettingsSyncClient;
  readonly ready: Promise<void>;
  readonly stop?: () => void;
} | null = null;

/** Test seam; production installs the Tauri client from `initSettings`. */
export function configureSettingsSync(client: SettingsSyncClient): void {
  syncListener?.stop?.();
  syncListener = null;
  sync = client;
}

function adoptMergedSettings(merged: unknown): void {
  // Shape guard at the boundary, NOT a try/catch: `validateSettings` never
  // throws — it coerces, and for a non-object it returns DEFAULT_SETTINGS
  // wholesale. Ignore malformed broadcasts and keep the last-good object.
  if (typeof merged !== "object" || merged === null || Array.isArray(merged)) {
    console.warn("Ignoring a structurally invalid settings broadcast");
    return;
  }
  mergedRevision += 1;
  settings.value = validateSettings(merged);
}

async function ensureSyncListener(client: SettingsSyncClient): Promise<void> {
  if (syncListener?.client === client) {
    await syncListener.ready;
    return;
  }
  syncListener?.stop?.();
  let listener!: NonNullable<typeof syncListener>;
  const ready = client
    .listenMerged(adoptMergedSettings)
    .then((stop) => {
      if (syncListener === listener) {
        syncListener = { ...listener, stop };
      } else {
        stop();
      }
    })
    .catch((error: unknown) => {
      if (syncListener === listener) {
        syncListener = null;
      }
      throw error;
    });
  listener = { client, ready };
  syncListener = listener;
  await listener.ready;
}

/**
 * Surface a background store-write failure.
 *
 * The host reports these on `store:write-failed`; without a listener a full
 * disk stayed completely silent, which is the failure `settings_merge.rs`
 * describes as already paid for once ("how a full disk used to look like a
 * successful write").
 */
export async function listenStoreWriteFailures(): Promise<void> {
  try {
    await listen<{ file?: string }>("store:write-failed", (event) => {
      const file = event.payload?.file ?? "settings";
      reportPersistError(`Couldn't save ${file} — your changes may be lost.`);
    });
  } catch (err) {
    console.warn("Could not subscribe to store write failures:", err);
  }
}

export async function initSettings(): Promise<void> {
  loadGeneration += 1;
  const forGeneration = loadGeneration;
  const mergedAtStart = mergedRevision;
  settingsLoadState.value = LOAD_LOADING;
  try {
    const loadedStore = await Store.load(STORE_FILE, {
      defaults: { [STORE_KEY]: DEFAULT_SETTINGS },
      autoSave: AUTOSAVE_DEBOUNCE_MS,
    });
    if (forGeneration !== loadGeneration) {
      return;
    }
    if (loadedStore.loadState.state === "unreadable") {
      throw new Error("settings.json is unreadable");
    }
    const raw = await loadedStore.get<unknown>(STORE_KEY);
    if (forGeneration !== loadGeneration) {
      return;
    }
    let loadedSettings: Settings | null = null;
    if (raw !== undefined) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("settings.json does not contain a settings object");
      }
      loadedSettings = validateSettings(raw);
    }
    if (sync === null) {
      sync = createTauriSettingsSync();
    }
    await ensureSyncListener(sync);
    if (forGeneration !== loadGeneration) {
      return;
    }
    store = loadedStore;
    // A merged broadcast is newer than the disk snapshot by definition. It
    // can arrive while the listener is being registered, or while a retry is
    // re-reading disk through an already-live listener; never replace it with
    // the older snapshot read at the start of this init.
    if (loadedSettings !== null && mergedRevision === mergedAtStart) {
      settings.value = loadedSettings;
    }
    settingsDegraded = false;
    settingsLoadState.value = LOAD_READY;
  } catch (err) {
    if (forGeneration !== loadGeneration) {
      return;
    }
    store = null;
    settingsDegraded = true;
    settingsLoadState.value = loadError(
      "Couldn't load settings. Defaults are temporary and won't overwrite settings.json.",
    );
    console.warn("Failed to load settings; defaults are temporary:", err);
  }
}

/**
 * Write settings through, and say so when the write fails.
 *
 * `set` only updates the plugin's in-memory cache; the disk write happens
 * later on the autosave timer, and the plugin discards that error. So a full
 * disk or a permission problem used to be completely silent: the UI showed the
 * new value, `PersistErrorBar` never appeared, and the loss only surfaced at
 * the next launch as settings that had "reset themselves". Awaiting an
 * explicit `save` moves that failure back into view.
 *
 * What this still does NOT fix: the plugin writes with truncate-then-write
 * rather than write-temp-then-rename, so a crash mid-write can leave the file
 * partial. Recovering from that needs an atomic writer on the Rust side.
 */
function persist(next: Settings): void {
  const current = store;
  if (current === null || settingsLoadState.value.status !== "ready") {
    return;
  }
  void (async () => {
    try {
      await current.set(STORE_KEY, next);
      await current.save();
    } catch {
      reportPersistError("Couldn't save settings — changes may not survive a relaunch.");
    }
  })();
}

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...settings.value, ...patch };
  if (settingsLoadState.value.status !== "ready") {
    settings.value = next;
    if (settingsDegraded) {
      reportPersistError("Settings are temporary until Deck can load settings.json.");
    }
    return;
  }
  // Optimistic and synchronous on purpose: every caller reads
  // `settings.value` on the next line (tab-manager.ts:1074-1075, :1080-1084), and
  // a round trip would make the UI wait on IPC for a font-size bump. The
  // Rust merge is what stops two windows clobbering each other; the merged
  // broadcast reconciles this window a moment later.
  settings.value = next;
  persist(next);
  // `apply_settings_patch` ALSO returns the merged object, and this
  // deliberately ignores it. There must be exactly one authoritative path to
  // state, and it is the `settings:merged` BROADCAST — one ordered stream
  // Rust emits to every window, so all windows converge on the same
  // sequence. The per-caller reply is not equivalent: when two windows patch
  // concurrently, this window's reply can be older than a broadcast it has
  // already applied, and adopting it afterwards would regress the value the
  // user is looking at. Applying both is what produces a flicker.
  //
  // So the reply is used for ONE thing: knowing the write failed.
  void sync?.sendPatch(patch).catch((err: unknown) => {
    console.warn("Settings patch merge failed:", err);
    reportPersistError("Couldn't sync settings across windows — other windows may be stale.");
  });
}

/**
 * Toggle the docked right column open/closed, keeping whichever tab it last
 * showed.
 *
 * Unlike the browser panel (`browser-store.ts`'s `openBrowser`/`closeBrowser`),
 * this needs no host coordination — the column is pure DOM content, not a
 * native view the host has to create or tear down — so a direct settings flip
 * is the whole operation.
 */
export function toggleDock(): void {
  updateSettings({ dockOpen: !settings.value.dockOpen });
}

/**
 * Reveal one tab of the dock, and report whether the dock ended up closed.
 *
 * "Reveal" rather than "select": a closed dock opens on that tab, an open dock
 * showing a different tab switches to it, and only asking for the tab already
 * on screen closes the column. That is what makes one chord per surface behave
 * the way a user expects — press it to see the thing, press it again to put it
 * away — without a second action per tab.
 *
 * The boolean is for the caller's focus handling: closing the dock should hand
 * focus back to the pane, and revealing a tab should not.
 */
export function revealDockTab(tab: DockTab): boolean {
  const current = settings.value;
  const closing = current.dockOpen && current.dockTab === tab;
  updateSettings({ dockOpen: !closing, dockTab: tab });
  return closing;
}

/**
 * Open the dock on one tab, and never close it.
 *
 * The rail's `Tools` rows are shortcuts that OPEN (DL §28): pressing the row of
 * a tab already on screen does nothing, because putting the column away is the
 * dock toggle's job, not a shortcut's. Chords keep `revealDockTab`'s
 * press-again-to-put-away behaviour — that is the difference between a chord
 * and a launcher, and it is deliberate rather than an inconsistency.
 */
export function openDockTab(tab: DockTab): void {
  updateSettings({ dockOpen: true, dockTab: tab });
}

/** Set or remove (value = undefined) a single color override. */
export function updateColorOverride(key: keyof TerminalColors, value: string | undefined): void {
  const { [key]: _removed, ...rest } = settings.value.colorOverrides;
  const colorOverrides = value === undefined ? rest : { ...rest, [key]: value };
  updateSettings({ colorOverrides });
}

/**
 * Forces the plugin-store's debounced autosave to disk — quit paths call
 * this so a just-changed setting survives the process exiting within the
 * autosave window.
 */
export async function flushSettingsSave(): Promise<void> {
  if (settingsLoadState.value.status === "ready") {
    await store?.save();
  }
}

export function resetSettings(): void {
  updateSettings(DEFAULT_SETTINGS);
}
