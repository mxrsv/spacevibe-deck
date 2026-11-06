import { describe, expect, it } from "vitest";
import { PUSH_KEYCHAIN_SERVICE } from "../../plugins/notification-service-extension/constants";
import { createPushKeyStore, type PushKeyBackend, type PushKeyOptions } from "./push-key-store";

const AFTER_FIRST_UNLOCK = 7;
function backend() {
  const items = new Map<string, string>();
  const calls: { op: string; key: string; options: PushKeyOptions }[] = [];
  const fake: PushKeyBackend = {
    async get(key, options) {
      calls.push({ op: "get", key, options });
      return items.get(key) ?? null;
    },
    async set(key, value, options) {
      calls.push({ op: "set", key, options });
      items.set(key, value);
    },
    async delete(key, options) {
      calls.push({ op: "delete", key, options });
      items.delete(key);
    },
  };
  return { fake, items, calls };
}

describe("push key store (the extension's contract)", () => {
  it("writes the key under the pairing id with the extension's service and accessibility, and no access group", async () => {
    const { fake, items, calls } = backend();
    await createPushKeyStore(fake, AFTER_FIRST_UNLOCK).write("pairing-1", "keyB64");
    expect(items.get("pairing-1")).toBe("keyB64");
    expect(calls[0].options).toEqual({
      keychainService: "dev.spacevibe.deck.mobile.push",
      keychainAccessible: AFTER_FIRST_UNLOCK,
    });
    expect(calls[0].options.keychainService).toBe(PUSH_KEYCHAIN_SERVICE);
    expect("accessGroup" in calls[0].options).toBe(false);
    expect("requireAuthentication" in calls[0].options).toBe(false);
  });

  it("deletes the key with the same options", async () => {
    const { fake, items, calls } = backend();
    const store = createPushKeyStore(fake, AFTER_FIRST_UNLOCK);
    await store.write("p", "k");
    await store.remove("p");
    expect(items.has("p")).toBe(false);
    expect(calls.at(-1)).toMatchObject({
      op: "delete",
      key: "p",
      options: { keychainService: PUSH_KEYCHAIN_SERVICE },
    });
  });

  it("ensure writes only a missing or different key (the launch migration)", async () => {
    const { fake, calls } = backend();
    const store = createPushKeyStore(fake, AFTER_FIRST_UNLOCK);
    await store.ensure("p", "k");
    expect(calls.map((c) => c.op)).toEqual(["get", "set"]);
    await store.ensure("p", "k");
    expect(calls.map((c) => c.op)).toEqual(["get", "set", "get"]);
    await store.ensure("p", "k2");
    expect(calls.at(-1)?.op).toBe("set");
  });
});
