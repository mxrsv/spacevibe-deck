import { describe, expect, it } from "vitest";
import { createChunkAssembler, splitChunks } from "./chunk";
import { createDesktopChannel, createPhoneChannel, type AppObject } from "./channel";
import { createNodeCrypto } from "./crypto-node";
import { randomId } from "./encoding";
import { PAIRING_TTL_MS } from "./limits";
import { parseAppMessage, okResponse } from "./messages";
import {
  acceptPairHello,
  createPairHello,
  openPairAccept,
  type DesktopInfo,
  type PendingPairing,
  type PhoneInfo,
} from "./pairing";
import { encodePairingQr, parsePairingQr } from "./qr";
import { parseResult } from "./results";

const crypto = createNodeCrypto();
const NOW = 1_800_000_000_000;
const PHONE: PhoneInfo = { name: "Ada's iPhone", model: "iPhone17,1", os: "iOS 26.1", v: 1 };
const DESKTOP: DesktopInfo = { name: "Studio Mac", os: "macos", appVersion: "1.4.0" };

/** The desktop side of a pairing: what it shows, then what it stores. */
function desktopShowsQr() {
  const keys = crypto.x25519KeyPair();
  const pending: PendingPairing = {
    pairingId: randomId(crypto),
    secret: crypto.randomBytes(32),
    desktopSecretKey: keys.secretKey,
    desktopPublicKey: keys.publicKey,
    expiresAt: NOW + PAIRING_TTL_MS,
    used: false,
  };
  const qrText = encodePairingQr({
    relayUrl: "https://api.deck.spacevibe.dev/relay",
    pairingId: pending.pairingId,
    desktopPublicKey: pending.desktopPublicKey,
    secret: pending.secret,
    expiresAt: pending.expiresAt,
    desktopName: DESKTOP.name,
  });
  return { pending, qrText };
}

function pairPhone() {
  const { pending, qrText } = desktopShowsQr();
  const scanned = parsePairingQr(qrText, NOW);
  if (!scanned.ok) throw new Error("the phone should accept a fresh QR");
  const attempt = createPairHello(crypto, scanned.value, PHONE);
  const accepted = acceptPairHello(crypto, pending, attempt.frame, NOW + 1_000, DESKTOP);
  if (!accepted.ok) throw new Error(`pairing refused: ${accepted.reason}`);
  const result = openPairAccept(crypto, attempt, accepted.reply);
  if (!result.ok) throw new Error(`the phone refused the accept: ${result.reason}`);
  return { pending, scanned: scanned.value, attempt, accepted, result };
}

/** A transport that hands every frame the other side sent, in order. */
function connect(
  pairing: { pairingId: string; phoneKey: Uint8Array; desktopKey: Uint8Array },
  ranges: {
    phone?: { version: number; min: number };
    desktop?: { version: number; min: number };
  } = {},
) {
  const toDesktop: Uint8Array[] = [];
  const toPhone: Uint8Array[] = [];
  const phone = createPhoneChannel({
    crypto,
    pairing: { pairingId: pairing.pairingId, pairKey: pairing.phoneKey },
    send: (frame) => toDesktop.push(frame),
    session: { device: PHONE.name, appVersion: "0.1.0" },
    local: ranges.phone,
  });
  const desktop = createDesktopChannel({
    crypto,
    lookup: (id) => (id === pairing.pairingId ? pairing.desktopKey : null),
    send: (frame) => toPhone.push(frame),
    local: ranges.desktop,
  });
  function pump() {
    while (toDesktop.length > 0 || toPhone.length > 0) {
      for (const frame of toDesktop.splice(0)) desktop.receive(frame);
      for (const frame of toPhone.splice(0)) phone.receive(frame);
    }
  }
  return { phone, desktop, toDesktop, toPhone, pump };
}

describe("phone ↔ desktop, end to end in memory", () => {
  it("pairs from a QR, opens a session, and serves a request, a chunked body and events", () => {
    const { scanned, attempt, accepted, result } = pairPhone();
    expect(result).toEqual({ ok: true, desktop: DESKTOP });
    expect(accepted.pairKey).toEqual(attempt.pairKey);

    const link = connect({
      pairingId: scanned.pairingId,
      phoneKey: attempt.pairKey,
      desktopKey: accepted.pairKey,
    });

    // The desktop service answers requests and greets the phone once it is proven.
    const chunkBodies = new Map<string, string>();
    link.desktop.onState((state) => {
      if (state !== "open") return;
      link.desktop.sendMessage({
        ev: "desktop",
        p: {
          name: DESKTOP.name,
          os: "macos",
          appVersion: DESKTOP.appVersion,
          protocol: 1,
          lan: [],
        },
      });
    });
    link.desktop.onMessage((raw) => {
      const message = parseAppMessage(raw);
      if (message?.kind !== "request") return;
      const { request } = message;
      if (request.m === "tree.subscribe") {
        link.desktop.sendMessage(okResponse(request.id, { tree: { projects: [] } }));
      } else if (request.m === "pane.read") {
        const body = "line\n".repeat(30_000);
        for (const chunk of splitChunks("read-1", body)) link.desktop.sendMessage(chunk);
        chunkBodies.set("read-1", body);
        link.desktop.sendMessage(okResponse(request.id, { chunked: "read-1" }));
      }
    });

    const phoneSeen: AppObject[] = [];
    link.phone.onMessage((message) => phoneSeen.push(message));

    link.phone.start();
    link.pump();
    expect(link.phone.state).toBe("open");
    expect(link.desktop.state).toBe("open");

    const hello = parseAppMessage(phoneSeen[0]);
    expect(hello).toMatchObject({
      kind: "event",
      event: { ev: "desktop", p: { name: "Studio Mac" } },
    });

    link.phone.sendMessage({ id: 1, m: "tree.subscribe", p: {} });
    link.pump();
    const response = parseAppMessage(phoneSeen[1]);
    if (response?.kind !== "response" || !response.response.ok) throw new Error("expected ok");
    expect(parseResult("tree.subscribe", response.response.r)).toEqual({ tree: { projects: [] } });

    link.phone.sendMessage({ id: 2, m: "pane.read", p: { paneId: 1, lines: 400 } });
    link.pump();
    const assembler = createChunkAssembler();
    let joined = "";
    for (const raw of phoneSeen.slice(2)) {
      const message = parseAppMessage(raw);
      if (message?.kind === "event" && message.event.ev === "chunk") {
        const step = assembler.push(message.event.p);
        if (step.status === "done") joined = step.text;
      }
    }
    expect(joined).toBe(chunkBodies.get("read-1"));
    const last = parseAppMessage(phoneSeen[phoneSeen.length - 1]);
    if (last?.kind !== "response" || !last.response.ok)
      throw new Error("expected the pane.read response");
    expect(parseResult("pane.read", last.response.r)).toEqual({ chunked: "read-1" });
    expect(link.phone.failures + link.desktop.failures).toBe(0);
  });

  it("drops and counts a tampered frame while the genuine next frame still works", () => {
    const { scanned, attempt, accepted } = pairPhone();
    const link = connect({
      pairingId: scanned.pairingId,
      phoneKey: attempt.pairKey,
      desktopKey: accepted.pairKey,
    });
    link.phone.start();
    link.pump();

    link.phone.sendMessage({ id: 5, m: "usage.get", p: {} });
    const genuine = link.toDesktop.splice(0)[0];
    const tampered = genuine.slice();
    tampered[tampered.length - 5] ^= 0x40;

    const seen: AppObject[] = [];
    link.desktop.onMessage((message) => seen.push(message));
    link.desktop.receive(tampered);
    expect(seen).toEqual([]);
    expect(link.desktop.failures).toBe(1);
    link.desktop.receive(genuine);
    expect(seen).toEqual([{ id: 5, m: "usage.get", p: {} }]);
    expect(link.desktop.state).toBe("open");
  });

  it("tells each side which one must update on a version mismatch", () => {
    const { scanned, attempt, accepted } = pairPhone();
    const ids = {
      pairingId: scanned.pairingId,
      phoneKey: attempt.pairKey,
      desktopKey: accepted.pairKey,
    };

    const oldPhone = connect(ids, {
      phone: { version: 1, min: 1 },
      desktop: { version: 3, min: 2 },
    });
    oldPhone.phone.start();
    oldPhone.pump();
    expect(oldPhone.phone.verdict).toBe("update-phone");
    expect(oldPhone.desktop.verdict).toBe("update-phone");
    expect(oldPhone.phone.state).toBe("closed");

    const oldDesktop = connect(ids, {
      phone: { version: 3, min: 2 },
      desktop: { version: 1, min: 1 },
    });
    oldDesktop.phone.start();
    oldDesktop.pump();
    expect(oldDesktop.phone.verdict).toBe("update-desktop");
    expect(oldDesktop.desktop.verdict).toBe("update-desktop");
    expect(oldDesktop.desktop.state).toBe("closed");
  });

  it("refuses a replayed pair-hello as used, and a revoked pairing at the session", () => {
    const { pending, attempt, accepted } = pairPhone();
    const replay = acceptPairHello(crypto, accepted.pending, attempt.frame, NOW + 2_000, DESKTOP);
    expect(replay).toMatchObject({ ok: false, reason: "used" });
    expect(pending.used).toBe(false);

    const link = connect({
      pairingId: pending.pairingId,
      phoneKey: attempt.pairKey,
      desktopKey: accepted.pairKey,
    });
    const revoked = createDesktopChannel({ crypto, lookup: () => null, send: () => {} });
    link.phone.start();
    revoked.receive(link.toDesktop.splice(0)[0]);
    expect(revoked.closeReason).toBe("unknown-pairing");
  });

  it("refuses an expired QR on both sides", () => {
    const { pending, qrText } = desktopShowsQr();
    const late = NOW + PAIRING_TTL_MS + 1;

    // The phone checks the clock before it ever claims at the relay.
    expect(parsePairingQr(qrText, late)).toEqual({ ok: false, reason: "expired" });

    // A phone with a slow clock still gets refused by the desktop.
    const scanned = parsePairingQr(qrText, NOW);
    if (!scanned.ok) throw new Error("fresh QR should parse");
    const attempt = createPairHello(crypto, scanned.value, PHONE);
    const refused = acceptPairHello(crypto, pending, attempt.frame, late, DESKTOP);
    expect(refused).toMatchObject({ ok: false, reason: "expired" });
    if (refused.ok) return;
    expect(openPairAccept(crypto, attempt, refused.reply)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
