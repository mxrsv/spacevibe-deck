import { describe, expect, it, vi } from "vitest";
import { createNodeCrypto } from "../../mobile/protocol/src/crypto-node";
import { b64urlDecode, b64urlEncode } from "../../mobile/protocol/src/encoding";
import { decodeFrame } from "../../mobile/protocol/src/frames";
import { PAIRING_TTL_MS } from "../../mobile/protocol/src/limits";
import { createPairHello, openPairAccept } from "../../mobile/protocol/src/pairing";
import { parsePairingQr } from "../../mobile/protocol/src/qr";
import type { SessionCipher, SessionFileIo } from "../account/session-store";
import { createPairingService, desktopName, type PairingDeps } from "./pairing";
import { createPairingStore } from "./pairing-store";

const crypto = createNodeCrypto();

function setup(
  over: { encrypt?: boolean; status?: number; fail?: boolean; relay?: string | null } = {},
) {
  let clock = 1_000_000;
  const file = { text: null as string | null };
  const io: SessionFileIo = {
    read: async () => file.text,
    write: async (text) => {
      file.text = text;
    },
    remove: async () => {
      file.text = null;
    },
  };
  const cipher: SessionCipher = {
    isEncryptionAvailable: () => over.encrypt ?? true,
    encryptString: (plain) => Buffer.from(plain),
    decryptString: (buf) => buf.toString(),
  };
  const store = createPairingStore({ io, cipher, now: () => clock });
  const registered: unknown[] = [];
  const events = { pending: 0, paired: [] as string[], revoked: [] as string[] };
  const deps: PairingDeps = {
    crypto,
    store,
    relayUrl: () => (over.relay === undefined ? "https://relay.example/relay" : over.relay),
    fetch: async (url, init) => {
      if (over.fail === true) throw new Error("offline");
      registered.push({ url, body: JSON.parse(init.body) });
      return { status: over.status ?? 201 };
    },
    appVersion: "1.2.3",
    platform: "darwin",
    now: () => clock,
    hostName: () => "Marks-MacBook.local",
    onPendingChanged: () => {
      events.pending += 1;
    },
    onPaired: (record) => events.paired.push(record.pairingId),
    onRevoked: (record) => events.revoked.push(record.pairingId),
  };
  return {
    service: createPairingService(deps),
    store,
    registered,
    events,
    file,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

describe("pairing", () => {
  it("registers the pairing, shows a QR the phone can parse, and expires after five minutes", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const started = await t.service.start();
      if (!started.ok) throw new Error("expected a pairing");
      expect(t.registered).toHaveLength(1);
      // The relay stores b64url(sha256(raw token bytes)), so the hash must be over the decoded token.
      expect(
        (t.registered[0] as { body: { desktopTokenHash: string } }).body.desktopTokenHash,
      ).toBe(b64urlEncode(crypto.sha256(b64urlDecode(started.pending.desktopToken))));
      const parsed = parsePairingQr(started.pending.qr, t.now());
      expect(parsed.ok && parsed.value.pairingId).toBe(started.pending.pairingId);
      expect(parsed.ok && parsed.value.desktopName).toBe("Marks-MacBook");
      expect(started.pending.expiresAt - t.now()).toBe(PAIRING_TTL_MS);
      expect((await t.service.start()).ok).toBe(false);

      const before = t.events.pending;
      t.advance(PAIRING_TTL_MS);
      vi.advanceTimersByTime(PAIRING_TTL_MS);
      expect(t.service.pending()).toBeNull();
      expect(t.events.pending).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes one pair-hello, stores the phone and refuses a second", async () => {
    const t = setup();
    const started = await t.service.start();
    if (!started.ok) throw new Error("expected a pairing");
    const qr = parsePairingQr(started.pending.qr, t.now());
    if (!qr.ok) throw new Error("bad qr");
    const attempt = createPairHello(crypto, qr.value, {
      name: "Mark's iPhone",
      model: "iPhone 16",
      os: "ios",
      v: 1,
    });

    const reply = await t.service.handleFrame(started.pending.pairingId, attempt.frame);
    expect(openPairAccept(crypto, attempt, reply!)).toMatchObject({
      ok: true,
      desktop: { os: "macos", appVersion: "1.2.3" },
    });
    expect(t.events.paired).toEqual([started.pending.pairingId]);
    expect(t.service.phones()).toMatchObject([{ name: "Mark's iPhone", model: "iPhone 16" }]);
    expect(t.service.pending()).toBeNull();
    expect(t.file.text).not.toContain(started.pending.desktopToken);

    // The pairing is spent: even a valid replay is refused.
    const again = await t.service.handleFrame(started.pending.pairingId, attempt.frame);
    expect(again === null || decodeFrame(again)?.type === "pair-reject").toBe(true);
    expect(t.service.phones()).toHaveLength(1);
  });

  it("rejects a hello that arrives after expiry, even a valid one", async () => {
    const t = setup();
    const started = await t.service.start();
    if (!started.ok) throw new Error("expected a pairing");
    const qr = parsePairingQr(started.pending.qr, t.now());
    if (!qr.ok) throw new Error("bad qr");
    const attempt = createPairHello(crypto, qr.value, { name: "P", model: "m", os: "ios", v: 1 });
    t.advance(PAIRING_TTL_MS + 1);
    const reply = await t.service.handleFrame(started.pending.pairingId, attempt.frame);
    // The pending pairing is already gone: nothing answers, and nothing is stored.
    expect(reply).toBeNull();
    expect(t.service.phones()).toEqual([]);
  });

  it("does not burn the QR on a bad proof", async () => {
    const t = setup();
    const started = await t.service.start();
    if (!started.ok) throw new Error("expected a pairing");
    const qr = parsePairingQr(started.pending.qr, t.now());
    if (!qr.ok) throw new Error("bad qr");
    const other = parsePairingQr(started.pending.qr, t.now());
    if (!other.ok) throw new Error("bad qr");
    const forged = createPairHello(
      crypto,
      { ...other.value, secret: crypto.randomBytes(32) },
      { name: "x", model: "m", os: "ios", v: 1 },
    );
    const reply = await t.service.handleFrame(started.pending.pairingId, forged.frame);
    expect(decodeFrame(reply!)).toEqual({ type: "pair-reject", reason: "bad-proof" });
    const good = createPairHello(crypto, qr.value, { name: "ok", model: "m", os: "ios", v: 1 });
    expect(
      decodeFrame((await t.service.handleFrame(started.pending.pairingId, good.frame))!)?.type,
    ).toBe("pair-accept");
  });

  it.each([
    [{ encrypt: false }, "encryption-unavailable"],
    [{ status: 409 }, "relay-rejected"],
    [{ fail: true }, "relay-unreachable"],
    [{ relay: null }, "no-relay"],
  ])("refuses to start with a reason: %j", async (over, reason) => {
    const t = setup(over);
    expect(await t.service.start()).toEqual({ ok: false, reason });
    expect(t.service.pending()).toBeNull();
  });

  it("revokes by deleting the local record and telling the service", async () => {
    const t = setup();
    const started = await t.service.start();
    if (!started.ok) throw new Error("expected a pairing");
    const qr = parsePairingQr(started.pending.qr, t.now());
    if (!qr.ok) throw new Error("bad qr");
    const attempt = createPairHello(crypto, qr.value, { name: "P", model: "m", os: "ios", v: 1 });
    await t.service.handleFrame(started.pending.pairingId, attempt.frame);
    expect(await t.service.revoke(started.pending.pairingId)).toBe(true);
    expect(t.service.phones()).toEqual([]);
    expect(t.events.revoked).toEqual([started.pending.pairingId]);
    expect(t.store.get(started.pending.pairingId)).toBeNull();
    expect(await t.service.revoke("missing")).toBe(false);
  });

  it("cleans the hostname for the phone", () => {
    expect(desktopName("Dev-Box.lan")).toBe("Dev-Box");
    expect(desktopName("a\u0007b")).toBe("ab");
    expect(b64urlDecode("AA").length).toBe(1);
  });
});
