import * as SecureStore from "expo-secure-store";
import type { KeyValueStore } from "./key-value";

// AFTER_FIRST_UNLOCK so a push or a background wake can read the keys while the phone is locked
// but has been unlocked once since boot (spec MOB3).
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const secureKeyValue: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
