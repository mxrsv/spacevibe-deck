/**
 * The one storage seam. The phone keeps pairings and its few preferences in the Keychain (spec
 * MOB3, no AsyncStorage), but the modules above this interface never import expo, so they run
 * in plain Node under vitest.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function memoryKeyValue(): KeyValueStore & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
    },
    delete: async (key) => {
      entries.delete(key);
    },
  };
}
