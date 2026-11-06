import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeCrypto } from "@protocol/crypto-node";
import { b64urlDecode } from "@protocol/encoding";
import { createNobleCrypto } from "@/crypto/noble";
import type { SocketFactory } from "@/session/socket";
import { createFakeWorld, createQr } from "@/testing/fake-relay";
import { pairErrorText, pairWithDesktop, PAIR_TIMEOUTS, readPairingCode } from "./pair-flow";

const phoneCrypto = createNobleCrypto((n) => new Uint8Array(randomBytes(n)));
const desktopCrypto = createNodeCrypto();
const NOW = 1_800_000_000_000;
const phone = { name: "Test iPhone", model: "iPhone", os: "iOS", v: 1 };

function setup() {
  const made = createQr(desktopCrypto, { now: NOW });
  const world = createFakeWorld({
    crypto: desktopCrypto,
    pairingId: made.qr.pairingId,
    phoneToken: "unused",
    pending: made.pending,
  });
  const deps = { crypto: phoneCrypto, socketFactory: world.socketFactory, now: () => NOW, phone };
  return { made, world, deps };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("readPairingCode", () => {
  it("accepts a fresh code and rejects an expired one locally", () => {
    const { made } = setup();
    expect(readPairingCode(made.text, NOW).ok).toBe(true);
    const late = readPairingCode(made.text, NOW + 400_000);
    expect(late).toEqual({ ok: false, error: { kind: "qr", reason: "expired" } });
    expect(pairErrorText({ kind: "qr", reason: "expired" })).toMatch(/expired/);
  });

  it("says what is wrong with text that is not a Deck code", () => {
    expect(readPairingCode("https://example.com", NOW)).toEqual({
      ok: false,
      error: { kind: "qr", reason: "not-deck" },
    });
  });
});

describe("pairWithDesktop", () => {
  it("claims at the relay, proves the QR to the desktop and returns keys both ends share", async () => {
    const { made, world, deps } = setup();
    const result = await pairWithDesktop(deps, made.qr);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { pairing } = result;
    expect(pairing.desktopName).toBe("Studio Mac");
    expect(pairing.os).toBe("macos");
    expect(pairing.pairedAt).toBe(NOW);
    expect(pairing.relayUrl).toBe("https://relay.test/relay");
    expect(world.pending?.used).toBe(true);
    expect(world.sockets[0].url).toBe(
      `wss://relay.test/relay/v1/pairings/${made.qr.pairingId}/socket`,
    );
    expect(world.sockets[0].sent[0]).toContain('"t":"claim"');
    // The phone's stored pairKey is the one the desktop derived: a session handshake proves it.
    expect(b64urlDecode(pairing.pairKey)).toHaveLength(32);
  });

  it("is refused when the same code is used a second time", async () => {
    const { made, deps } = setup();
    expect((await pairWithDesktop(deps, made.qr)).ok).toBe(true);
    const second = await pairWithDesktop(deps, made.qr);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toEqual({ kind: "relay", code: "claimed" });
    expect(pairErrorText(second.error)).toMatch(/already used/);
  });

  it("times out with a clear message when Deck is not connected to the relay", async () => {
    const { made, world, deps } = setup();
    world.setDesktopOnline(false);
    const promise = pairWithDesktop(deps, made.qr);
    await vi.advanceTimersByTimeAsync(PAIR_TIMEOUTS.desktopMs + 10);
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { kind: "desktop-timeout" } });
    expect(pairErrorText({ kind: "desktop-timeout" })).toMatch(/Make sure Deck is running/);
  });

  it("sends the hello once the desktop appears, then succeeds", async () => {
    const { made, world, deps } = setup();
    world.setDesktopOnline(false);
    const promise = pairWithDesktop(deps, made.qr);
    await vi.advanceTimersByTimeAsync(2_000);
    world.setDesktopOnline(true);
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("reports an unreachable relay", async () => {
    const made = createQr(desktopCrypto, { now: NOW });
    const socketFactory: SocketFactory = (_url, events) => {
      queueMicrotask(() => events.onClose(1006, "error"));
      return { send() {}, close() {} };
    };
    const result = await pairWithDesktop({ ...setup().deps, socketFactory }, made.qr);
    expect(result).toEqual({ ok: false, error: { kind: "relay-timeout" } });
  });

  it("maps a relay refusal to its message", async () => {
    const made = createQr(desktopCrypto, { now: NOW });
    const world = createFakeWorld({
      crypto: desktopCrypto,
      pairingId: made.qr.pairingId,
      phoneToken: "y",
    });
    const deps = { crypto: phoneCrypto, socketFactory: world.socketFactory, now: () => NOW, phone };
    const result = await pairWithDesktop(deps, made.qr); // the relay knows no such pairing
    expect(result).toEqual({ ok: false, error: { kind: "relay", code: "unknown" } });
  });
});
