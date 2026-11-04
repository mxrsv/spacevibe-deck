import { describe, expect, it } from "vitest";
import { memoryKeyValue } from "@/storage/key-value";
import {
  createPairingStore,
  parseStoredPairing,
  summarize,
  type StoredPairing,
} from "./pairing-store";

const pairing = (id: string, pairedAt: number): StoredPairing => ({
  pairingId: id,
  relayUrl: "https://relay.test/relay",
  desktopName: `Mac ${id}`,
  os: "macos",
  pairedAt,
  psk: "psk",
  dpk: "dpk",
  pairKey: "pairKey",
  pushKey: "pushKey",
  phoneToken: "phoneToken",
});

describe("pairing store (MOB5: several desktops)", () => {
  it("keeps several pairings, oldest first, and forgets one without touching the rest", async () => {
    const store = createPairingStore(memoryKeyValue());
    await store.save(pairing("b", 2));
    await store.save(pairing("a", 1));
    expect((await store.list()).map((p) => p.pairingId)).toEqual(["a", "b"]);
    await store.remove("a");
    expect((await store.list()).map((p) => p.pairingId)).toEqual(["b"]);
  });

  it("saving the same pairing twice does not duplicate it", async () => {
    const store = createPairingStore(memoryKeyValue());
    await store.save(pairing("a", 1));
    await store.save({ ...pairing("a", 1), desktopName: "Renamed" });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].desktopName).toBe("Renamed");
  });

  it("skips a damaged record instead of trusting it", async () => {
    const kv = memoryKeyValue();
    const store = createPairingStore(kv);
    await store.save(pairing("a", 1));
    await store.save(pairing("b", 2));
    await kv.set("deck.pairing.a", '{"pairingId":"a"}');
    expect((await store.list()).map((p) => p.pairingId)).toEqual(["b"]);
    expect(parseStoredPairing("nope")).toBeNull();
  });

  it("removes the secrets from the Keychain entry when forgotten", async () => {
    const kv = memoryKeyValue();
    const store = createPairingStore(kv);
    await store.save(pairing("a", 1));
    await store.remove("a");
    expect([...kv.entries.keys()].filter((k) => k.includes("pairing."))).toEqual([]);
  });

  it("summaries carry no key material", () => {
    expect(Object.keys(summarize(pairing("a", 1))).sort()).toEqual(
      ["desktopName", "os", "pairedAt", "pairingId", "relayUrl"].sort(),
    );
  });
});
