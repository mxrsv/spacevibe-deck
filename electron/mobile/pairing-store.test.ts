import { describe, expect, it } from "vitest";
import type { SessionCipher, SessionFileIo } from "../account/session-store";
import { createPairingStore, guardedCipher, type StoredPairing } from "./pairing-store";

function record(id: string, extra: Partial<StoredPairing> = {}): StoredPairing {
  return {
    pairingId: id,
    relayUrl: "https://relay.example",
    phoneName: "Phone",
    phoneModel: "iPhone",
    pairedAt: 1,
    lastSeenAt: null,
    dsk: "dsk",
    ppk: "ppk",
    pairKey: "pk",
    desktopToken: "tok",
    ...extra,
  };
}

function memoryIo(initial: string | null = null) {
  const file = { text: initial, writes: 0, removed: 0 };
  const io: SessionFileIo = {
    read: async () => file.text,
    write: async (contents) => {
      file.text = contents;
      file.writes += 1;
    },
    remove: async () => {
      file.text = null;
      file.removed += 1;
    },
  };
  return { file, io };
}

/** A reversible fake: "enc:" + plain, so a wrong cipher shows as an unreadable file. */
function cipher(available = true): SessionCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`),
    decryptString: (buf) => {
      const text = buf.toString();
      if (!text.startsWith("enc:")) throw new Error("bad");
      return text.slice(4);
    },
  };
}

describe("pairing store", () => {
  it("round-trips records through one encrypted envelope with no plaintext keys", async () => {
    const { file, io } = memoryIo();
    const store = createPairingStore({ io, cipher: cipher() });
    expect((await store.add(record("a", { pairKey: "SECRET-KEY" }))).ok).toBe(true);
    expect(file.text).not.toContain("SECRET-KEY");
    const reopened = createPairingStore({ io, cipher: cipher() });
    expect(await reopened.load()).toBe("ok");
    expect(reopened.get("a")?.pairKey).toBe("SECRET-KEY");
  });

  it("refuses to pair, and writes nothing, when encryption is unavailable", async () => {
    const { file, io } = memoryIo();
    const store = createPairingStore({ io, cipher: cipher(false) });
    expect(await store.add(record("a"))).toEqual({ ok: false, reason: "encryption-unavailable" });
    expect(file.text).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("never overwrites a file it cannot read", async () => {
    const { file, io } = memoryIo('{"v":1,"data":"bm90IGVuYw=="}');
    const store = createPairingStore({ io, cipher: cipher() });
    expect(await store.load()).toBe("unreadable");
    expect(await store.add(record("a"))).toEqual({ ok: false, reason: "unreadable" });
    expect(await store.remove("a")).toBe(false);
    store.touch("a", 5);
    expect(file.writes).toBe(0);
    expect(file.removed).toBe(0);
    expect(file.text).toBe('{"v":1,"data":"bm90IGVuYw=="}');
  });

  it("keeps only a revoke record, never the keys, until the relay confirms", async () => {
    const { file, io } = memoryIo();
    const store = createPairingStore({ io, cipher: cipher() });
    await store.add(record("a", { pairKey: "SECRET-KEY", dsk: "SECRET-DSK" }));
    expect(await store.remove("a")).toBe(true);
    expect(store.get("a")).toBeNull();
    expect(store.revoking()).toEqual([
      { pairingId: "a", relayUrl: "https://relay.example", desktopToken: "tok" },
    ]);
    expect(file.text).not.toBeNull();
    expect(Buffer.from(JSON.parse(file.text!).data, "base64").toString()).not.toContain("SECRET");
    // It survives a restart, so a revoke the relay never heard is retried.
    const restarted = createPairingStore({ io, cipher: cipher() });
    await restarted.load();
    expect(restarted.revoking()).toHaveLength(1);
    await restarted.finishRevoke("a");
    expect(file.text).toBeNull();
  });

  it("reads a file written before revokes were durable", async () => {
    const { io } = memoryIo();
    const legacy = Buffer.from(`enc:${JSON.stringify([record("old")])}`).toString("base64");
    const store = createPairingStore({
      io: { ...io, read: async () => JSON.stringify({ v: 1, data: legacy }) },
      cipher: cipher(),
    });
    expect(await store.load()).toBe("ok");
    expect(store.get("old")?.pairingId).toBe("old");
  });

  it("treats Linux's basic_text backend as no encryption at all", () => {
    const base = cipher();
    expect(guardedCipher(base, "linux", () => "basic_text").isEncryptionAvailable()).toBe(false);
    expect(guardedCipher(base, "linux", () => "gnome_libsecret").isEncryptionAvailable()).toBe(
      true,
    );
    expect(guardedCipher(base, "darwin", () => "basic_text").isEncryptionAvailable()).toBe(true);
    expect(guardedCipher(cipher(false), "linux", () => null).isEncryptionAvailable()).toBe(false);
  });

  it("persists lastSeenAt at most once a minute", async () => {
    const { file, io } = memoryIo();
    let clock = 1_000_000;
    const store = createPairingStore({ io, cipher: cipher(), now: () => clock });
    await store.add(record("a"));
    const afterAdd = file.writes;
    clock += 10_000;
    store.touch("a", clock);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(file.writes).toBe(afterAdd);
    expect(store.get("a")?.lastSeenAt).toBe(clock);
    clock += 61_000;
    store.touch("a", clock);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(file.writes).toBe(afterAdd + 1);
  });
});
