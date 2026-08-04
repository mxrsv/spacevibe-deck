import { signal } from "@preact/signals";
import { Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  type Settings,
  type TerminalColors,
} from "./settings-schema";
import { reportPersistError } from "../chrome/events";

const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
const AUTOSAVE_DEBOUNCE_MS = 300;

export const settings = signal<Settings>(DEFAULT_SETTINGS);

let store: Store | null = null;

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
  const next = { ...settings.value, ...patch };
  settings.value = next;
  persist(next);
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
