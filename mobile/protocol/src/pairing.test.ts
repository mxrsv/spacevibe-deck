import { describe, expect, it } from "vitest";
import { createNodeCrypto } from "./crypto-node";
import { randomId } from "./encoding";
import { decodeFrame, encodeFrame } from "./frames";
import { PAIRING_TTL_MS } from "./limits";
import {
  acceptPairHello,
  createPairHello,
  openPairAccept,
  rejectFrame,
  type DesktopInfo,
  type PendingPairing,
  type PhoneInfo,
} from "./pairing";
import type { PairingQr } from "./qr";

const crypto = createNodeCrypto();
const NOW = 1_800_000_000_000;
const PHONE: PhoneInfo = { name: "Ada's iPhone", model: "iPhone17,1", os: "iOS 26.1", v: 1 };
const DESKTOP: DesktopInfo = { name: "Studio Mac", os: "macos", appVersion: "1.4.0" };

function setup() {
  const keys = crypto.x25519KeyPair();
  const pending: PendingPairing = {
    pairingId: randomId(crypto),
    secret: crypto.randomBytes(32),
    desktopSecretKey: keys.secretKey,
    desktopPublicKey: keys.publicKey,
    expiresAt: NOW + PAIRING_TTL_MS,
    used: false,
  };
  const qr: PairingQr = {
    relayUrl: "https://relay.example",
    pairingId: pending.pairingId,
    desktopPublicKey: keys.publicKey,
    secret: pending.secret,
    expiresAt: pending.expiresAt,
    desktopName: DESKTOP.name,
  };
  return { pending, qr };
}

describe("pairing exchange", () => {
  it("lets a phone that scanned the QR and the desktop agree on one pair key", () => {
    const { pending, qr } = setup();
    const attempt = createPairHello(crypto, qr, PHONE);
    const result = acceptPairHello(crypto, pending, attempt.frame, NOW, DESKTOP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pairKey).toEqual(attempt.pairKey);
    expect(result.phonePublicKey).toEqual(attempt.phonePublicKey);
    expect(result.phone).toEqual(PHONE);
    expect(result.pending.used).toBe(true);
    expect(pending.used).toBe(false); // the input record is not mutated

    expect(openPairAccept(crypto, attempt, result.reply)).toEqual({ ok: true, desktop: DESKTOP });
  });

  it("refuses a second pair-hello as used, even a valid one", () => {
    const { pending, qr } = setup();
    const first = createPairHello(crypto, qr, PHONE);
    const accepted = acceptPairHello(crypto, pending, first.frame, NOW, DESKTOP);
    if (!accepted.ok) throw new Error("first pairing should succeed");

    for (const frame of [first.frame, createPairHello(crypto, qr, PHONE).frame]) {
      const again = acceptPairHello(crypto, accepted.pending, frame, NOW + 1, DESKTOP);
      expect(again).toMatchObject({ ok: false, reason: "used" });
      expect(openPairAccept(crypto, first, (again as { reply: Uint8Array }).reply)).toEqual({
        ok: false,
        reason: "used",
      });
    }
  });

  it("refuses at and after the expiry, and accepts the last millisecond", () => {
    const { pending, qr } = setup();
    const attempt = createPairHello(crypto, qr, PHONE);
    expect(acceptPairHello(crypto, pending, attempt.frame, pending.expiresAt - 1, DESKTOP).ok).toBe(
      true,
    );
    expect(
      acceptPairHello(crypto, pending, attempt.frame, pending.expiresAt, DESKTOP),
    ).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  it("answers unknown for a pairing it is not showing", () => {
    const { qr } = setup();
    const attempt = createPairHello(crypto, qr, PHONE);
    expect(acceptPairHello(crypto, null, attempt.frame, NOW, DESKTOP)).toMatchObject({
      ok: false,
      reason: "unknown",
    });
  });

  it("answers bad-proof for a phone that never saw the QR, and keeps the QR usable", () => {
    const { pending, qr } = setup();
    const guess = createPairHello(crypto, { ...qr, secret: crypto.randomBytes(32) }, PHONE);
    const refused = acceptPairHello(crypto, pending, guess.frame, NOW, DESKTOP);
    expect(refused).toMatchObject({ ok: false, reason: "bad-proof" });
    // The failed guess did not burn the pairing: the real phone still gets in.
    const real = createPairHello(crypto, qr, PHONE);
    expect(acceptPairHello(crypto, pending, real.frame, NOW, DESKTOP).ok).toBe(true);
  });

  it("answers bad-proof for garbage, a wrong frame type and a low-order public key", () => {
    const { pending, qr } = setup();
    expect(acceptPairHello(crypto, pending, Uint8Array.of(1, 2, 3), NOW, DESKTOP)).toMatchObject({
      reason: "bad-proof",
    });
    expect(acceptPairHello(crypto, pending, rejectFrame("used"), NOW, DESKTOP)).toMatchObject({
      reason: "bad-proof",
    });
    const genuine = createPairHello(crypto, qr, PHONE).frame;
    const decoded = decodeFrame(genuine);
    if (decoded?.type !== "pair-hello") throw new Error("expected pair-hello");
    const lowOrder = encodeFrame({ ...decoded, phonePublicKey: new Uint8Array(32) });
    expect(acceptPairHello(crypto, pending, lowOrder, NOW, DESKTOP)).toMatchObject({
      reason: "bad-proof",
    });
  });

  it("rejects a tampered pair-hello box", () => {
    const { pending, qr } = setup();
    const decoded = decodeFrame(createPairHello(crypto, qr, PHONE).frame);
    if (decoded?.type !== "pair-hello") throw new Error("expected pair-hello");
    const box = decoded.box.slice();
    box[0] ^= 1;
    const tampered = encodeFrame({ ...decoded, box });
    expect(acceptPairHello(crypto, pending, tampered, NOW, DESKTOP)).toMatchObject({
      reason: "bad-proof",
    });
  });

  it("sanitises the phone details the desktop will display", () => {
    const { pending, qr } = setup();
    const attempt = createPairHello(crypto, qr, {
      ...PHONE,
      name: "Ada" + String.fromCharCode(0x1b) + "[2J" + "x".repeat(100),
    });
    const result = acceptPairHello(crypto, pending, attempt.frame, NOW, DESKTOP);
    expect(result.ok && result.phone.name).toBe(("Ada[2J" + "x".repeat(100)).slice(0, 64));
  });

  it("lets the phone tell apart a refusal, a forged accept and garbage", () => {
    const { qr } = setup();
    const attempt = createPairHello(crypto, qr, PHONE);
    expect(openPairAccept(crypto, attempt, rejectFrame("expired"))).toEqual({
      ok: false,
      reason: "expired",
    });
    const forged = encodeFrame({ type: "pair-accept", box: crypto.randomBytes(48) });
    expect(openPairAccept(crypto, attempt, forged)).toEqual({ ok: false, reason: "bad-proof" });
    expect(openPairAccept(crypto, attempt, Uint8Array.of(9))).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(openPairAccept(crypto, attempt, attempt.frame)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
