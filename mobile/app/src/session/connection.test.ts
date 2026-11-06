import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionRange } from "@protocol/channel";
import { createNodeCrypto } from "@protocol/crypto-node";
import { b64urlEncode } from "@protocol/encoding";
import { RELAY_ERROR_TEXT } from "@protocol/relay-messages";
import { createNobleCrypto } from "@/crypto/noble";
import { createFakeWorld } from "@/testing/fake-relay";
import { createDesktopConnection, HANDSHAKE_TIMEOUT_MS } from "./connection";
import { createRelayLink } from "./relay-link";
import { RpcError } from "./rpc";

const phoneCrypto = createNobleCrypto((n) => new Uint8Array(randomBytes(n)));
const desktopCrypto = createNodeCrypto();

function setup(options: { desktopVersion?: VersionRange; token?: string } = {}) {
  const pairKey = new Uint8Array(randomBytes(32));
  const pairingId = b64urlEncode(new Uint8Array(randomBytes(16)));
  const phoneToken = b64urlEncode(new Uint8Array(randomBytes(32)));
  const world = createFakeWorld({
    crypto: desktopCrypto,
    pairingId,
    phoneToken,
    pairKey,
    desktopVersion: options.desktopVersion,
  });
  const connection = createDesktopConnection({
    pairing: { pairingId, pairKey },
    crypto: phoneCrypto,
    session: { device: "Test iPhone", appVersion: "1.0.0" },
    random: () => 0.5,
    openLink: (kind, handlers) =>
      kind === "relay"
        ? createRelayLink({
            socketFactory: world.socketFactory,
            relayUrl: "https://relay.test/relay",
            pairingId,
            phoneToken: options.token ?? phoneToken,
            handlers,
          })
        : null,
  });
  return { world, connection };
}

const settle = async (ms = 1): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("desktop connection", () => {
  it("reaches online through the real handshake and answers requests", async () => {
    const { connection } = setup();
    connection.start();
    await settle();
    const snap = connection.getSnapshot();
    expect(snap.status).toBe("online");
    expect(snap.path).toBe("relay");
    expect(snap.live?.name).toBe("Studio Mac");
    expect(snap.live?.os).toBe("macos");

    const answer = connection.rpc.request("usage.get", {});
    await settle();
    await expect(answer).resolves.toEqual({ usage: { today: 1 } });

    const refused = connection.rpc.request("agents.list", {});
    const error = await refused.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe("unavailable");
  });

  it("times out a request the desktop never answers", async () => {
    const { connection } = setup();
    connection.start();
    await settle();
    const caught = connection.rpc
      .request("pane.input", { paneId: 1, data: "x" }, { timeoutMs: 500 })
      .catch((e: unknown) => e);
    await settle(600);
    expect(((await caught) as RpcError).code).toBe("timeout");
  });

  it("shows the desktop offline with its last-seen time, then online when it returns (MOB11)", async () => {
    const { connection, world } = setup();
    world.setDesktopOnline(false, 1_234);
    connection.start();
    await settle();
    expect(connection.getSnapshot()).toMatchObject({
      status: "offline",
      lastSeen: 1_234,
      path: "relay",
    });
    world.setDesktopOnline(true);
    await settle();
    expect(connection.getSnapshot().status).toBe("online");
  });

  it("goes offline and fails waiting requests when the desktop leaves", async () => {
    const { connection, world } = setup();
    connection.start();
    await settle();
    expect(connection.getSnapshot().status).toBe("online");
    world.setDesktopOnline(false, 5_000);
    await settle();
    expect(connection.getSnapshot()).toMatchObject({ status: "offline", lastSeen: 5_000 });
    await expect(connection.rpc.request("usage.get", {})).rejects.toMatchObject({
      code: "not-connected",
    });
  });

  it("shows the block (MOB10) but keeps checking slowly, so a forged verdict cannot silence the desktop for good", async () => {
    const { connection, world } = setup({ desktopVersion: { version: 9, min: 9 } });
    connection.start();
    await settle();
    expect(connection.getSnapshot()).toMatchObject({ status: "blocked", block: "update-phone" });
    const first = world.sockets.length;
    await settle(30_000);
    expect(world.sockets.length).toBe(first); // not hammering
    await settle(31_000);
    expect(world.sockets.length).toBeGreaterThan(first); // the 60 s check
    expect(connection.getSnapshot().status).toBe("blocked");
    const second = world.sockets.length;
    connection.start(); // the app returned to the front: check at once
    await settle(50);
    expect(world.sockets.length).toBeGreaterThan(second);
  });

  it("blocks the desktop when Deck is too old", async () => {
    const { connection } = setup({ desktopVersion: { version: 0, min: 0 } });
    connection.start();
    await settle();
    expect(connection.getSnapshot()).toMatchObject({ status: "blocked", block: "update-desktop" });
  });

  it("marks the desktop revoked when the relay says so, and stops (MOB2)", async () => {
    const { connection, world } = setup();
    connection.start();
    await settle();
    world.dropAll(4410);
    await settle(60_000);
    expect(connection.getSnapshot().status).toBe("revoked");
    expect(world.sockets).toHaveLength(1);
  });

  it("treats the relay forgetting an established pairing (4404) as the desktop removing this phone", async () => {
    const { connection, world } = setup();
    connection.start();
    await settle();
    world.dropAll(4404);
    await settle(60_000);
    expect(connection.getSnapshot()).toMatchObject({
      status: "revoked",
      problem: "The desktop removed this phone, or the pairing expired. Pair it again.",
    });
    expect(world.sockets).toHaveLength(1);
  });

  it("shows the relay's message for a refusal and does not hammer it (MOB8)", async () => {
    const { connection, world } = setup({ token: b64urlEncode(new Uint8Array(32)) });
    connection.start();
    await settle(60_000);
    expect(connection.getSnapshot()).toMatchObject({
      status: "failed",
      problem: RELAY_ERROR_TEXT.unauthorized,
    });
    expect(world.sockets).toHaveLength(1);
  });

  it("reconnects with backoff after the network drops", async () => {
    const { connection, world } = setup();
    connection.start();
    await settle();
    world.dropAll(1006);
    await settle();
    expect(connection.getSnapshot().status).toBe("connecting");
    await settle(2_000);
    expect(connection.getSnapshot().status).toBe("online");
    expect(world.sockets).toHaveLength(2);
  });

  it("gives up on a desktop that never confirms the session and tries again", async () => {
    const { connection, world } = setup();
    world.goSilent();
    connection.start();
    await settle();
    expect(connection.getSnapshot().status).toBe("connecting");
    await settle(HANDSHAKE_TIMEOUT_MS + 2_000);
    expect(world.sockets.length).toBeGreaterThan(1);
  });

  it("stop closes the socket and fails requests; retryNow starts over", async () => {
    const { connection, world } = setup();
    connection.start();
    await settle();
    connection.stop();
    await settle();
    expect(world.live).toHaveLength(0);
    connection.retryNow();
    await settle();
    expect(connection.getSnapshot().status).toBe("online");
  });

  it("delivers desktop events to listeners", async () => {
    const { connection, world } = setup();
    const seen: string[] = [];
    connection.onEvent((event) => seen.push(event.ev));
    connection.start();
    await settle();
    world.sendEvent({ ev: "term.end", p: { sub: "s1", reason: "closed" } });
    await settle();
    expect(seen).toEqual(["desktop", "term.end"]);
  });
});
