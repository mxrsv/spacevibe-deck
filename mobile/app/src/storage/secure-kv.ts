import * as SecureStore from "expo-secure-store";
import type { KeyValueStore } from "./key-value";

// "After first unlock" so a push or a background wake can read the keys while the phone is locked
// but has been unlocked once since boot (spec MOB3); THIS_DEVICE_ONLY so the keys never travel in a
// backup to another device: a restored phone must pair again.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureKeyValue: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
