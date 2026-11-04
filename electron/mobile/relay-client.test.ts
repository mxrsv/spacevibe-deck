import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PING_INTERVAL_MS } from "../../mobile/protocol/src/limits";
import {
  BACKOFF_MAX_MS,
  backoffDelay,
  createRelayConnection,
  type RelayConnectionOptions,
  type RelaySocket,
} from "./relay-client";

class FakeSocket implements RelaySocket {
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  onopen: RelaySocket["onopen"] = null;
  onmessage: RelaySocket["onmessage"] = null;
  onclose: RelaySocket["onclose"] = null;
  onerror: RelaySocket["onerror"] = null;
  constructor(readonly url: string) {}
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {}
  open(): void {
    this.onopen?.({});
  }
  text(value: object): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  binary(bytes: number[]): void {
    this.onmessage?.({ data: new Uint8Array(bytes).buffer });
  }
  drop(code = 1006): void {
    this.onclose?.({ code });
  }
}

const PAIRING = "A".repeat(22);
const TOKEN = "T".repeat(43);

describe("relay connection", () => {
  let sockets: FakeSocket[];
  let frames: number[][];
  let stops: string[];
  let presence: boolean[];

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    frames = [];
    stops = [];
    presence = [];
  });
  afterEach(() => vi.useRealTimers());

  function connection(extra: Partial<RelayConnectionOptions> = {}) {
    const relay = createRelayConnection({
      relayUrl: "https://relay.example/relay",
      pairingId: PAIRING,
      role: "desktop",
      token: TOKEN,
      random: () => 0,
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      onBinary: (frame) => frames.push([...frame]),
      onConnected: (up) => presence.push(up),
      onStop: (reason) => stops.push(reason),
      ...extra,
    });
    relay.connect();
    return relay;
  }

  const ready = { t: "ready", role: "desktop", peerOnline: false, peerLastSeen: null };

  it("authenticates first, and only forwards binary frames once the relay said ready", () => {
    const relay = connection();
    const socket = sockets[0]!;
    expect(socket.url).toBe(`wss://relay.example/relay/v1/pairings/${PAIRING}/socket`);
    expect(socket.binaryType).toBe("arraybuffer");
    socket.open();
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      t: "auth",
      role: "desktop",
      token: TOKEN,
    });
    socket.binary([1, 2]);
    expect(frames).toEqual([]);
    socket.text(ready);
    socket.binary([3, 4]);
    expect(frames).toEqual([[3, 4]]);
    expect(relay.sendBinary(Uint8Array.of(9))).toBe(true);
    expect(socket.sent.at(-1)).toEqual(Uint8Array.of(9));
  });

  it("pings on the keep-alive interval", () => {
    connection();
    sockets[0]!.open();
    sockets[0]!.text(ready);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(
      sockets[0]!.sent.map((item) => (typeof item === "string" ? JSON.parse(item).t : "bin")),
    ).toEqual(["auth", "ping"]);
  });

  it("reconnects after a drop with a growing backoff that ready resets", () => {
    connection();
    sockets[0]!.open();
    sockets[0]!.drop();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop();
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    sockets[2]!.open();
    sockets[2]!.text(ready);
    sockets[2]!.drop();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(4);
    expect(backoffDelay(20, () => 0)).toBe(BACKOFF_MAX_MS);
  });

  it("stops for good on revoked and reports it", () => {
    connection();
    sockets[0]!.open();
    sockets[0]!.text(ready);
    sockets[0]!.text({ t: "revoked" });
    sockets[0]!.drop(4410);
    vi.advanceTimersByTime(60_000);
    expect(stops).toEqual(["revoked"]);
    expect(sockets).toHaveLength(1);
    expect(presence).toEqual([true, false]);
  });

  it("stops on a terminal close code even without the text message", () => {
    connection();
    sockets[0]!.open();
    sockets[0]!.drop(4401);
    expect(stops).toEqual(["unauthorized"]);
  });

  it("keeps retrying on rate-limited and reports presence changes", () => {
    const peers: boolean[] = [];
    connection({ onPeer: (peer) => peers.push(peer.online) });
    sockets[0]!.open();
    sockets[0]!.text(ready);
    sockets[0]!.text({ t: "peer", online: true, lastSeen: 5 });
    sockets[0]!.text({ t: "error", code: "rate-limited" });
    sockets[0]!.drop(4429);
    vi.advanceTimersByTime(1_000);
    expect(stops).toEqual([]);
    expect(sockets).toHaveLength(2);
    expect(peers).toEqual([true]);
  });

  it("does not reconnect after close()", () => {
    const relay = connection();
    sockets[0]!.open();
    relay.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(relay.sendBinary(Uint8Array.of(1))).toBe(false);
  });
});
