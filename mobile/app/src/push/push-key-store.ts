import { PUSH_KEYCHAIN_SERVICE } from "../../plugins/notification-service-extension/constants";

/**
 * The options the Notification Service Extension reads the push key with (its README): a service
 * name of its own, readable while the phone is locked, no access group (the shared group is the
 * app's only one in a build with the plugin), no authentication prompt.
 */
export interface PushKeyOptions {
  readonly keychainService: string;
  readonly keychainAccessible: number;
}

export function pushKeyOptions(afterFirstUnlock: number): PushKeyOptions {
  return { keychainService: PUSH_KEYCHAIN_SERVICE, keychainAccessible: afterFirstUnlock };
}

export interface PushKeyBackend {
  get(key: string, options: PushKeyOptions): Promise<string | null>;
  set(key: string, value: string, options: PushKeyOptions): Promise<void>;
  delete(key: string, options: PushKeyOptions): Promise<void>;
}

export interface PushKeyStore {
  /** Writes the base64url push key for a pairing; the key name is the pairing id. */
  write(pairingId: string, pushKey: string): Promise<void>;
  /** Writes only when the stored value is missing or different (the launch migration). */
  ensure(pairingId: string, pushKey: string): Promise<void>;
  remove(pairingId: string): Promise<void>;
}

export function createPushKeyStore(
  backend: PushKeyBackend,
  afterFirstUnlock: number,
): PushKeyStore {
  const options = pushKeyOptions(afterFirstUnlock);
  return {
    write: (pairingId, pushKey) => backend.set(pairingId, pushKey, options),
    async ensure(pairingId, pushKey) {
      if ((await backend.get(pairingId, options)) !== pushKey) {
        await backend.set(pairingId, pushKey, options);
      }
    },
    remove: (pairingId) => backend.delete(pairingId, options),
  };
}
