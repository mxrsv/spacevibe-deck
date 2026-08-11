import { signal } from "@preact/signals";
import { Store } from "../host/store-host";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  type Settings,
  type TerminalColors,
} from "./settings-schema";
import { reportPersistError } from "../chrome/events";
import {
  createTauriSettingsSync,
  type SettingsSyncClient,
} from "./settings-sync";

const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
const AUTOSAVE_DEBOUNCE_MS = 300;

export const settings = signal<Settings>(DEFAULT_SETTINGS);

let store: Store | null = null;
let sync: SettingsSyncClient | null = null;

/** Test seam; production installs the Tauri client from `initSettings`. */
export function configureSettingsSync(client: SettingsSyncClient): void {
  sync = client;
}

/** Load settings from disk at startup — on failure fall back to defaults, app keeps running. */
export async function initSettings(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, {
      defaults: { [STORE_KEY]: DEFAULT_SETTINGS },
      autoSave: AUTOSAVE_DEBOUNCE_MS,
    });
    const raw = await store.get<unknown>(STORE_KEY);
    if (raw !== undefined && raw !== null) {
      settings.value = validateSettings(raw);
    }
    if (sync === null) {
      sync = createTauriSettingsSync();
    }
    await sync.listenMerged((merged) => {
      // Shape guard at the boundary, NOT a try/catch: `validateSettings` never
      // throws — it coerces, and for a non-object it returns DEFAULT_SETTINGS
      // wholesale (settings-schema.ts:199-201). So handing it a structurally
      // malformed broadcast would silently reset this window's live settings to
      // defaults, which is the worst possible response to "I cannot understand
      // this message". Ignore it instead and keep what we have.
      //
      // Per-field junk is deliberately NOT treated the same way: that already
      // has defined coercion semantics used everywhere else in this repo, and
      // changing them is out of scope.
      if (typeof merged !== "object" || merged === null) {
        console.warn("Ignoring a structurally invalid settings broadcast");
        return;
      }
      settings.value = validateSettings(merged);
    });
  } catch (err) {
    console.warn("Failed to load settings, using defaults:", err);
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
  if (current === null) {
    return;
  }
  void (async () => {
    try {
      await current.set(STORE_KEY, next);
      await current.save();
    } catch {
      reportPersistError(
        "Couldn't save settings — changes may not survive a relaunch.",
      );
    }
  })();
}

export function updateSettings(patch: Partial<Settings>): void {
  // Optimistic and synchronous on purpose: every caller reads
  // `settings.value` on the next line (tab-manager.ts:1074-1075, :1080-1084), and
  // a round trip would make the UI wait on IPC for a font-size bump. The
  // Rust merge is what stops two windows clobbering each other; the merged
  // broadcast reconciles this window a moment later.
  const next = { ...settings.value, ...patch };
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
    reportPersistError(
      "Couldn't sync settings across windows — other windows may be stale.",
    );
  });
}

/** Set or remove (value = undefined) a single color override. */
export function updateColorOverride(
  key: keyof TerminalColors,
  value: string | undefined,
): void {
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
  await store?.save();
}

export function resetSettings(): void {
  settings.value = DEFAULT_SETTINGS;
  persist(DEFAULT_SETTINGS);
}
