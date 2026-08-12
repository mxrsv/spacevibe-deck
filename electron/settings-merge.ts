/**
 * Settings writes that survive two windows editing at once — the port of
 * `src-tauri/src/settings_merge.rs`.
 *
 * The renderer used to read the whole object from its own signal, change one
 * key and write it back. With peer windows that is a lost update: whoever
 * writes second overwrites the other's change with a value it read before that
 * change existed. The fix is to send the CHANGE, not the result — the main
 * process holds the only writer and every window learns the merged value.
 */
import type { StoreRegistry } from "./store";

/** Mirrors `src/settings/settings-store.ts` — same file, same key. */
const STORE_FILE = "settings.json";
const STORE_KEY = "settings";

/**
 * Shallow merge: a patch's top-level keys replace their values outright,
 * matching `{ ...settings.value, ...patch }` on the renderer side. A patch that
 * is not an object is ignored rather than allowed to replace everything.
 */
export function mergeSettings(current: unknown, patch: unknown): unknown {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return current;
  }
  const base =
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...(patch as Record<string, unknown>) };
}

/**
 * Merge `patch` into the stored settings and return the result.
 *
 * The save is explicit rather than left to the autosave debounce: a debounce
 * discards its error, which is how a full disk used to look like a successful
 * write. Broadcasting to the other windows is the caller's job.
 */
export async function applySettingsPatch(
  stores: StoreRegistry,
  patch: unknown,
): Promise<unknown> {
  const store = await stores.open(STORE_FILE);
  const merged = mergeSettings(store.get(STORE_KEY), patch);
  store.set(STORE_KEY, merged);
  await store.save();
  return merged;
}
