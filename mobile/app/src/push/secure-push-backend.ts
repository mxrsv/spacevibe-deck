import * as SecureStore from "expo-secure-store";
import { createPushKeyStore, type PushKeyBackend } from "./push-key-store";

const backend: PushKeyBackend = {
  get: (key, options) => SecureStore.getItemAsync(key, options),
  set: (key, value, options) => SecureStore.setItemAsync(key, value, options),
  delete: (key, options) => SecureStore.deleteItemAsync(key, options),
};

export const pushKeyStore = createPushKeyStore(
  backend,
  SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
);
