import { signal } from "@preact/signals";
import { Store } from "@tauri-apps/plugin-store";
import {
  BUILT_IN_PRESET,
  PRESETS_VERSION,
  removePreset,
  renamePresetIn,
  upsertPreset,
  validatePresets,
  type Preset,
  type PresetsData,
} from "../lib/preset-schema";
import { reportPersistError } from "../chrome/events";

const STORE_FILE = "presets.json";
const STORE_KEY = "presets";

export const presetsData = signal<PresetsData>({
  version: PRESETS_VERSION,
  presets: [],
});

let store: Store | null = null;

/** Load presets at startup — on failure fall back to empty, app keeps running. */
export async function initPresets(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    presetsData.value = validatePresets(raw);
  } catch (err) {
    console.warn("Failed to load presets, starting empty:", err);
  }
}

/** Signal stays the source of truth for the running session even when the
 * write below fails — see reportPersistError's doc comment for why. */
function persist(next: PresetsData): void {
  presetsData.value = next;
  if (!store) {
    reportPersistError("Preset change wasn't saved (storage unavailable)");
    return;
  }
  store
    .set(STORE_KEY, next)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn("Failed to save presets:", err);
      reportPersistError("Preset change wasn't saved to disk");
    });
}

export function savePreset(preset: Preset): void {
  persist({
    ...presetsData.value,
    presets: upsertPreset(presetsData.value.presets, preset),
  });
}

export function renamePreset(id: string, name: string): void {
  persist({
    ...presetsData.value,
    presets: renamePresetIn(presetsData.value.presets, id, name),
  });
}

export function deletePreset(id: string): void {
  const { lastUsedId, ...rest } = presetsData.value;
  persist({
    ...rest,
    ...(lastUsedId !== undefined && lastUsedId !== id ? { lastUsedId } : {}),
    presets: removePreset(presetsData.value.presets, id),
  });
}

export function markLastUsed(id: string): void {
  persist({ ...presetsData.value, lastUsedId: id });
}

/** Cards for the Open board: built-in always present and first. */
export function boardPresets(): readonly Preset[] {
  return [BUILT_IN_PRESET, ...presetsData.value.presets];
}
