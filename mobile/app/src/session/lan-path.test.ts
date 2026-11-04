import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeCrypto } from "@protocol/crypto-node";
import { b64urlEncode } from "@protocol/encoding";
import { createNobleCrypto } from "@/crypto/noble";
import { createFakeWorld } from "@/testing/fake-relay";
import { createDesktopConnection } from "./connection";
import {
  isPrivateIPv4,
  lanCandidates,
  lanSocketUrl,
  MAX_LAN_CANDIDATES,
  sameAddresses,
} from "./lan-addresses";
import { createLanLink } from "./lan-link";
import { createRelayLink } from "./relay-link";

const phoneCrypto = createNobleCrypto((n) => new Uint8Array(randomBytes(n)));
const desktopCrypto = createNodeCrypto();
const HOME = { host: "192.168.1.20", port: 5000 };
const OTHER = { host: "10.0.0.7", port: 5001 };

function setup(lan: readonly { host: string; port: number }[], relayResponseDelayMs = 0) {
  const pairKey = new Uint8Array(randomBytes(32));
  const pairingId = b64urlEncode(new Uint8Array(randomBytes(16)));
  const phoneToken = b64urlEncode(new Uint8Array(randomBytes(32)));
  const world = createFakeWorld({
    crypto: desktopCrypto,
    pairingId,
    phoneToken,
    pairKey,
    lan,
    relayResponseDelayMs,
  });
  const connection = createDesktopConnection({
    pairing: { pairingId, pairKey },
    crypto: phoneCrypto,
    session: { device: "iPhone", appVersion: "1" },
    random: () => 0.5,
    openLink: (_kind, handlers) =>
      createRelayLink({
        socketFactory: world.socketFactory,
        relayUrl: "https://relay.test/relay",
        pairingId,
        phoneToken,
        handlers,
      }),
    openLan: (address, handlers) =>
      createLanLink({ socketFactory: world.lanSocketFactory, address, pairingId, handlers }),
  });
  return { world, connection, pairingId };
}
const settle = async (ms = 1): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LAN addresses", () => {
  it("accepts only private IPv4 with a real port, deduplicated and capped", () => {
    for (const host of ["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.0.9"])
      expect(isPrivateIPv4(host)).toBe(true);
    for (const host of [
      "8.8.8.8",
      "127.0.0.1",
      "169.254.1.1",
      "100.64.0.1",
      "172.32.0.1",
      "192.169.0.1",
      "::1",
      "fe80::1",
      "example.com",
      "10.0.0.256",
      "10.0.0",
    ]) {
      expect(isPrivateIPv4(host)).toBe(false);
    }
    expect(
      lanCandidates([
        { host: "8.8.8.8", port: 1 },
        { host: "192.168.1.5", port: 0 },
        { host: "192.168.1.5", port: 70000 },
        { host: "192.168.1.5", port: 8080 },
        { host: "192.168.1.5", port: 8080 },
        { host: "10.0.0.1", port: 9 },
      ]),
    ).toEqual([
      { host: "192.168.1.5", port: 8080 },
      { host: "10.0.0.1", port: 9 },
    ]);
    const many = Array.from({ length: 9 }, (_, i) => ({ host: `10.0.0.${i + 1}`, port: 80 }));
    expect(lanCandidates(many)).toHaveLength(MAX_LAN_CANDIDATES);
    expect(sameAddresses([HOME], [{ ...HOME }])).toBe(true);
    expect(lanSocketUrl(HOME, "abc")).toBe("ws://192.168.1.20:5000/v1/abc/socket");
  });
});

describe("LAN link", () => {
  it("is up when the socket opens, sends binary only, and gives up after the connect timeout", async () => {
    const { world, pairingId } = setup([HOME]);
    const events: string[] = [];
    const up = createLanLink({
      socketFactory: world.lanSocketFactory,
      address: HOME,
      pairingId,
      handlers: {
        onUp: () => events.push("up"),
        onPeer() {},
        onFrame() {},
        onDown: (d) => events.push(d.kind),
      },
    });
    await settle();
    expect(events).toEqual(["up"]);
    up.send(new Uint8Array([1, 2, 3]));
    expect(world.lanSockets[0].sent).toHaveLength(1);

    world.setLanReachable(OTHER.host, OTHER.port, false);
    const silent: string[] = [];
    createLanLink({
      socketFactory: world.lanSocketFactory,
      address: OTHER,
      pairingId,
      handlers: {
        onUp: () => silent.push("up"),
        onPeer() {},
        onFrame() {},
        onDown: () => silent.push("down"),
      },
    });
    await settle(1_900);
    expect(silent).toEqual([]);
    await settle(200);
    expect(silent).toEqual(["down"]);
  });
});

describe("moving between the relay and the LAN (MOB9)", () => {
  it("runs the handshake over the LAN, prefers it, and keeps the relay socket for presence", async () => {
    const { world, connection } = setup([HOME]);
    connection.start();
    await settle(50);
    const snap = connection.getSnapshot();
    expect(snap).toMatchObject({ status: "online", path: "lan" });
    expect(snap.epoch).toBe(1);
    expect(world.live.filter((s) => s.url.startsWith("wss://"))).toHaveLength(1); // the relay socket stays
    const answer = connection.rpc.request("usage.get", {});
    await settle();
    await expect(answer).resolves.toEqual({ usage: { today: 1 } });
    expect(world.lanSockets[0].sent.length).toBeGreaterThan(1); // hello + sealed frames, all binary
  });

  it("ends the streams it opened over the relay before it leaves that channel", async () => {
    const { world, connection } = setup([HOME]);
    world.setLanReachable(HOME.host, HOME.port, false);
    connection.start();
    await settle(2_100);
    const tree = connection.rpc.request("tree.subscribe", {}).catch(() => null);
    await settle();
    await tree;
    world.announceLan([OTHER]);
    await settle(50);
    expect(connection.getSnapshot().path).toBe("lan");
    expect(world.requests.map((r) => r.m)).toContain("tree.unsubscribe");
  });

  it("ends a relay subscribe that is still in flight when the session moves to the LAN", async () => {
    const { world, connection } = setup([HOME], 80);
    world.setLanReachable(HOME.host, HOME.port, false);
    connection.start();
    await settle(2_100); // online over the relay, the LAN address failed
    world.setLanReachable(OTHER.host, OTHER.port, true);
    const subscribed = connection.rpc.request("tree.subscribe", {}).catch(() => null);
    world.announceLan([OTHER]); // the move happens while the subscribe's answer is still on its way
    await settle(30);
    expect(connection.getSnapshot().path).toBe("lan");
    expect(world.requests.map((r) => r.m)).not.toContain("tree.unsubscribe");
    await settle(300);
    await subscribed;
    expect(world.requests.map((r) => r.m)).toContain("tree.unsubscribe");
  });

  it("ignores addresses that are not private IPv4 and stays on the relay", async () => {
    const { world, connection } = setup([
      { host: "8.8.8.8", port: 5000 },
      { host: "127.0.0.1", port: 5000 },
    ]);
    connection.start();
    await settle(50);
    expect(connection.getSnapshot()).toMatchObject({ status: "online", path: "relay", epoch: 0 });
    expect(world.lanSockets).toHaveLength(0);
  });

  it("tries the next address when the first does not answer within 2 s", async () => {
    const { world, connection } = setup([HOME, OTHER]);
    world.setLanReachable(HOME.host, HOME.port, false);
    connection.start();
    await settle(2_100);
    expect(world.lanSockets).toHaveLength(2);
    await settle(50);
    expect(connection.getSnapshot()).toMatchObject({ status: "online", path: "lan" });
  });

  it("falls back to the relay at once when the LAN socket dies, replays on it, and retries the LAN with backoff", async () => {
    const { world, connection } = setup([HOME]);
    connection.start();
    await settle(50);
    expect(connection.getSnapshot().path).toBe("lan");
    const epochOnLan = connection.getSnapshot().epoch;
    world.setLanReachable(HOME.host, HOME.port, false); // the phone left the network
    world.dropLan();
    await settle(50);
    expect(connection.getSnapshot()).toMatchObject({ status: "online", path: "relay" });
    expect(connection.getSnapshot().epoch).toBeGreaterThan(epochOnLan);
    expect(world.sockets.filter((s) => s.url.startsWith("wss://"))).toHaveLength(1); // the relay link was kept and a new hello replaced the session
    const viaRelay = connection.rpc.request("usage.get", {});
    await settle();
    await expect(viaRelay).resolves.toEqual({ usage: { today: 1 } });

    // Back on the Wi-Fi: the next retry succeeds without re-pairing.
    world.setLanReachable(HOME.host, HOME.port, true);
    await settle(35_000);
    expect(connection.getSnapshot()).toMatchObject({ status: "online", path: "lan" });
  });

  it("tries again at once when the desktop announces a new address", async () => {
    const { world, connection } = setup([HOME]);
    world.setLanReachable(HOME.host, HOME.port, false);
    connection.start();
    await settle(2_100); // the only address failed: a retry is waiting out its backoff
    expect(connection.getSnapshot().path).toBe("relay");
    world.announceLan([OTHER]);
    await settle(50);
    expect(connection.getSnapshot()).toMatchObject({ status: "online", path: "lan" });
  });

  it("subscribers see the epoch change on each move, so subscriptions are replayed", async () => {
    const { world, connection } = setup([HOME]);
    const epochs: number[] = [];
    connection.subscribe(() => {
      const e = connection.getSnapshot().epoch;
      if (epochs.at(-1) !== e) epochs.push(e);
    });
    connection.start();
    await settle(50);
    world.setLanReachable(HOME.host, HOME.port, false);
    world.dropLan();
    await settle(50);
    expect(epochs).toEqual([0, 1, 2]);
  });

  it("leaves no orphan relay socket when the relay and then the LAN drop before the relay retry", async () => {
    const { world, connection } = setup([HOME]);
    connection.start();
    await settle(50);
    expect(connection.getSnapshot().path).toBe("lan");
    world.dropAll(1006); // the relay socket dies while the LAN carries the session; a retry is scheduled
    await settle(10);
    world.setLanReachable(HOME.host, HOME.port, false);
    world.dropLan(); // the LAN dies before that retry runs: the fallback opens a relay link at once
    await settle(5_000);
    const relay = () => world.live.filter((s) => s.url.startsWith("wss://"));
    expect(relay()).toHaveLength(1);
    expect(connection.getSnapshot()).toMatchObject({ status: "online", path: "relay" });
    connection.stop();
    await settle(50);
    expect(world.live).toHaveLength(0);
  });

  it("revoke while on the LAN ends revoked: the relay's word arrives after the LAN closed and is still heard (MOB2)", async () => {
    const { world, connection } = setup([HOME]);
    connection.start();
    await settle(50);
    expect(connection.getSnapshot().path).toBe("lan");
    world.setLanReachable(HOME.host, HOME.port, false);
    world.dropLan(); // the desktop closes the LAN session first ...
    setTimeout(() => world.dropAll(4410), 25); // ... and the relay's `revoked` follows
    await settle(200);
    expect(connection.getSnapshot().status).toBe("revoked");
    await settle(60_000);
    expect(connection.getSnapshot().status).toBe("revoked");
  });

  it("closing the connection closes the LAN socket too", async () => {
    const { world, connection } = setup([HOME]);
    connection.start();
    await settle(50);
    connection.stop();
    await settle(50);
    expect(world.live).toHaveLength(0);
    expect(world.lanSockets.every((s) => s.closedWith !== null)).toBe(true);
  });
});
