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
 * Keys a past version wrote that no version reads any more.
 *
 * `validateSettings` in `src/settings/settings-schema.ts` rebuilds Settings from
 * a fixed whitelist, so a retired key is already invisible to every READ. What
 * nothing did was remove it from disk — this merge writes the RAW stored object
 * back, so a profile created before the key was retired carries it forever.
 *
 * Named retirees only, deliberately: dropping every key absent from the
 * whitelist would also destroy keys written by a NEWER Deck when a user
 * downgrades, turning a harmless stale value into real data loss.
 */
const RETIRED_KEYS: readonly string[] = [
  // The browser's docked right column, its resize drag and `browserWidth` were
  // removed on 2026-08-15 when the browser became a tab on the stage strip.
  "browserWidth",
  // The docked right column stopped being the file explorer's on 2026-08-16:
  // it hosts several surfaces as tabs, so `explorerOpen`/`explorerWidth` became
  // `dockOpen`/`dockWidth`. The width is not carried over on purpose — the old
  // floor (180) is below the new one (360), so an old value would arrive
  // already out of range.
  "explorerOpen",
  "explorerWidth",
];

/**
 * Shallow merge: a patch's top-level keys replace their values outright,
 * matching `{ ...settings.value, ...patch }` on the renderer side. A patch that
 * is not an object is ignored rather than allowed to replace everything.
 *
 * Retired keys are dropped from the result so the next write also cleans them
 * off disk.
 */
export function mergeSettings(current: unknown, patch: unknown): unknown {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return current;
  }
  const base =
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const merged = { ...base, ...(patch as Record<string, unknown>) };
  return Object.fromEntries(
    Object.entries(merged).filter(([key]) => !RETIRED_KEYS.includes(key)),
  );
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
