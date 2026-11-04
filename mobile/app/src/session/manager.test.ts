import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeCrypto } from "@protocol/crypto-node";
import { b64urlEncode } from "@protocol/encoding";
import { createNobleCrypto } from "@/crypto/noble";
import { createPairingStore, type StoredPairing } from "@/pairing/pairing-store";
import { memoryKeyValue } from "@/storage/key-value";
import { createFakeWorld } from "@/testing/fake-relay";
import { createSessionManager } from "./manager";

const phoneCrypto = createNobleCrypto((n) => new Uint8Array(randomBytes(n)));
const desktopCrypto = createNodeCrypto();
const b64 = (n: number): string => b64urlEncode(new Uint8Array(randomBytes(n)));

function pairingOf(name: string): StoredPairing {
  return {
    pairingId: b64(16),
    relayUrl: "https://relay.test/relay",
    desktopName: name,
    os: "macos",
    pairedAt: 1,
    psk: b64(32),
    dpk: b64(32),
    pairKey: b64(32),
    pushKey: b64(32),
    phoneToken: b64(32),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("session manager", () => {
  it("connects every stored desktop while the app is active and stops them in the background", async () => {
    const store = createPairingStore(memoryKeyValue());
    const a = pairingOf("A");
    const b = pairingOf("B");
    await store.save(a);
    await store.save(b);
    const worlds = new Map(
      [a, b].map((p) => [
        p.pairingId,
        createFakeWorld({
          crypto: desktopCrypto,
          pairingId: p.pairingId,
          phoneToken: p.phoneToken,
          pairKey: new Uint8Array(Buffer.from(p.pairKey, "base64url")),
        }),
      ]),
    );
    const manager = createSessionManager({
      store,
      crypto: phoneCrypto,
      session: { device: "iPhone", appVersion: "1.0.0" },
      socketFactory: (url, events) => {
        const world = [...worlds.entries()].find(([id]) => url.includes(id))![1];
        return world.socketFactory(url, events);
      },
    });
    await manager.load();
    expect(manager.getEntries().map((e) => e.summary.desktopName)).toEqual(["A", "B"]);
    manager.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    expect(manager.getEntries().map((e) => e.connection.getSnapshot().status)).toEqual([
      "online",
      "online",
    ]);
    manager.setActive(false);
    await vi.advanceTimersByTimeAsync(5);
    for (const world of worlds.values()) expect(world.live).toHaveLength(0);
  });

  it("forgetting a desktop revokes it at the relay, then deletes its keys (MOB2)", async () => {
    const kv = memoryKeyValue();
    const store = createPairingStore(kv);
    const p = pairingOf("A");
    const world = createFakeWorld({
      crypto: desktopCrypto,
      pairingId: p.pairingId,
      phoneToken: p.phoneToken,
      pairKey: new Uint8Array(Buffer.from(p.pairKey, "base64url")),
    });
    const manager = createSessionManager({
      store,
      crypto: phoneCrypto,
      session: { device: "iPhone", appVersion: "1.0.0" },
      socketFactory: world.socketFactory,
    });
    await manager.addPairing(p);
    manager.setActive(true);
    await vi.advanceTimersByTimeAsync(5);
    const done = manager.forget(p.pairingId);
    await vi.advanceTimersByTimeAsync(50);
    expect(await done).toEqual({ revokedOnRelay: true });
    expect(
      world.sockets.some((s) =>
        s.sent.some((m) => typeof m === "string" && m.includes('"revoke"')),
      ),
    ).toBe(true);
    expect(manager.getEntries()).toHaveLength(0);
    expect(await store.list()).toEqual([]);
  });

  it("still forgets the keys when the relay cannot be reached, and says so", async () => {
    const store = createPairingStore(memoryKeyValue());
    const p = pairingOf("A");
    const manager = createSessionManager({
      store,
      crypto: phoneCrypto,
      session: { device: "iPhone", appVersion: "1.0.0" },
      socketFactory: (_url, events) => {
        queueMicrotask(() => events.onClose(1006, "error"));
        return { send() {}, close() {} };
      },
    });
    await manager.addPairing(p);
    const done = manager.forget(p.pairingId);
    await vi.advanceTimersByTimeAsync(10);
    expect(await done).toEqual({ revokedOnRelay: false });
    expect(await store.list()).toEqual([]);
  });
});
