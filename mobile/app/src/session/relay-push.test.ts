import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeCrypto } from "@protocol/crypto-node";
import { b64urlEncode } from "@protocol/encoding";
import { createNobleCrypto } from "@/crypto/noble";
import { createPairingStore, type StoredPairing } from "@/pairing/pairing-store";
import { createPushKeyStore, type PushKeyBackend } from "@/push/push-key-store";
import { memoryKeyValue } from "@/storage/key-value";
import { createFakeWorld } from "@/testing/fake-relay";
import { createSessionManager } from "./manager";

const phoneCrypto = createNobleCrypto((n) => new Uint8Array(randomBytes(n)));
const desktopCrypto = createNodeCrypto();
const b64 = (n: number): string => b64urlEncode(new Uint8Array(randomBytes(n)));
const pairingOf = (): StoredPairing => ({
  pairingId: b64(16),
  relayUrl: "https://relay.test/relay",
  desktopName: "A",
  os: "macos",
  pairedAt: 1,
  psk: b64(32),
  dpk: b64(32),
  pairKey: b64(32),
  pushKey: b64(32),
  phoneToken: b64(32),
});

function keychain() {
  const items = new Map<string, string>();
  const backend: PushKeyBackend = {
    get: async (k) => items.get(k) ?? null,
    set: async (k, v) => void items.set(k, v),
    delete: async (k) => void items.delete(k),
  };
  return { items, store: createPushKeyStore(backend, 7) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(
  registration: () => { t: "push-token"; kind: "apns"; token: string; env: "sandbox" } | null,
) {
  const p = pairingOf();
  const world = createFakeWorld({
    crypto: desktopCrypto,
    pairingId: p.pairingId,
    phoneToken: p.phoneToken,
    pairKey: new Uint8Array(Buffer.from(p.pairKey, "base64url")),
  });
  const kc = keychain();
  const manager = createSessionManager({
    store: createPairingStore(memoryKeyValue()),
    crypto: phoneCrypto,
    session: { device: "iPhone", appVersion: "1" },
    socketFactory: world.socketFactory,
    pushKeys: kc.store,
    pushRegistration: registration,
  });
  return { p, world, kc, manager };
}
const pushMessages = (world: ReturnType<typeof createFakeWorld>): string[] =>
  world.sockets.flatMap((s) =>
    s.sent.filter((m): m is string => typeof m === "string" && m.includes("push-token")),
  );

describe("push registration through the relay link", () => {
  it("sends the token on every relay ready, so a rotated token reaches the relay", async () => {
    let token = "aa11bb22cc33";
    const { p, world, manager } = setup(() => ({
      t: "push-token",
      kind: "apns",
      token,
      env: "sandbox",
    }));
    await manager.addPairing(p);
    manager.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    expect(pushMessages(world)).toHaveLength(1);
    expect(JSON.parse(pushMessages(world)[0])).toEqual({
      t: "push-token",
      kind: "apns",
      token: "aa11bb22cc33",
      env: "sandbox",
    });
    token = "dd44ee55ff66";
    world.dropAll(1006);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pushMessages(world).map((m) => JSON.parse(m).token)).toEqual([
      "aa11bb22cc33",
      "dd44ee55ff66",
    ]);
  });

  it("announces a new token on the live link", async () => {
    let token: string | null = null;
    const { p, world, manager } = setup(() =>
      token === null ? null : { t: "push-token", kind: "apns", token, env: "sandbox" },
    );
    await manager.addPairing(p);
    manager.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    expect(pushMessages(world)).toHaveLength(0);
    token = "0011223344556677";
    manager.announcePush();
    expect(pushMessages(world)).toHaveLength(1);
  });

  it("sends nothing while push is off", async () => {
    const { p, world, manager } = setup(() => null);
    await manager.addPairing(p);
    manager.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    manager.announcePush();
    expect(pushMessages(world)).toHaveLength(0);
  });
});

describe("push keys follow the pairing", () => {
  it("writes the key when a pairing is saved, migrates missing ones at launch and deletes it on forget", async () => {
    const { p, world, kc, manager } = setup(() => null);
    void world;
    await manager.addPairing(p);
    expect(kc.items.get(p.pairingId)).toBe(p.pushKey);
    kc.items.delete(p.pairingId); // a pairing from before the extension existed
    await manager.load();
    expect(kc.items.get(p.pairingId)).toBe(p.pushKey);
    expect(manager.pushKeyOf(p.pairingId)).toHaveLength(32);
    expect(manager.pushKeyOf("nope")).toBeNull();
    const done = manager.forget(p.pairingId);
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(kc.items.has(p.pairingId)).toBe(false);
  });
});
