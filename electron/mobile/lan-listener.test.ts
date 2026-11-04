import type { NetworkInterfaceInfo } from "node:os";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLanListener,
  isPrivateLanAddress,
  privateLanAddresses,
  type InterfaceTable,
  type LanListener,
  type LanListenerDeps,
} from "./lan-listener";
import type { WsConnection } from "./ws-server";

const PAIRING = "A".repeat(22);

function iface(address: string, over: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/24`,
    ...over,
  } as NetworkInterfaceInfo;
}

describe("interface filter", () => {
  it.each([
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["172.16.0.1", true],
    ["172.31.255.1", true],
    ["172.15.0.1", false],
    ["172.32.0.1", false],
    ["192.168.1.20", true],
    ["192.169.1.20", false],
    ["169.254.10.1", false],
    ["100.64.0.5", false],
    ["100.127.0.5", false],
    ["8.8.8.8", false],
    ["127.0.0.1", false],
    ["0.0.0.0", false],
    ["10.0.0.256", false],
    ["fe80::1", false],
    ["::", false],
  ])("%s -> %s", (address, expected) => {
    expect(isPrivateLanAddress(address)).toBe(expected);
  });

  it("keeps private, non-internal IPv4 addresses only, sorted and unique", () => {
    const table: InterfaceTable = {
      en0: [iface("192.168.1.5"), iface("fe80::1", { family: "IPv6" })],
      en1: [iface("10.0.0.7"), iface("192.168.1.5")],
      utun1: [iface("100.64.1.1")],
      awdl0: [iface("169.254.3.3")],
      lo0: [iface("127.0.0.1", { internal: true })],
      pub: [iface("203.0.113.9")],
      fake: [iface("10.9.9.9", { internal: true })],
      missing: undefined,
    };
    expect(privateLanAddresses(table)).toEqual(["10.0.0.7", "192.168.1.5"]);
  });
});

const LOOPBACK: InterfaceTable = { lo: [iface("127.0.0.1")] };

function harness(over: Partial<LanListenerDeps> = {}) {
  const connections: WsConnection[] = [];
  const closed: string[] = [];
  const opened = { value: false };
  const onAddresses = vi.fn();
  const listener = createLanListener({
    isKnown: (id) => id === PAIRING,
    openSession: (_id, connection) => {
      connections.push(connection);
      return { isOpen: () => opened.value, close: (reason) => closed.push(reason) };
    },
    onAddresses,
    log: vi.fn(),
    listInterfaces: () => LOOPBACK,
    // A test cannot bind a LAN address; loopback stands in for it.
    isAllowed: (address) => address === "127.0.0.1",
    ...over,
  });
  return { listener, connections, closed, opened, onAddresses };
}

const running: LanListener[] = [];
afterEach(() => {
  for (const listener of running.splice(0)) listener.stop();
  vi.useRealTimers();
});

async function started(over: Partial<LanListenerDeps> = {}) {
  const h = harness(over);
  running.push(h.listener);
  await h.listener.start();
  const [{ port }] = h.listener.addresses() as [{ port: number }];
  return { ...h, port };
}

/** A raw TCP client; the server destroying it shows up as ECONNRESET, which is the point. */
function rawConnect(port: number): net.Socket {
  const socket = net.connect(port, "127.0.0.1");
  socket.on("error", () => {});
  return socket;
}

function connect(port: number, path = `/v1/${PAIRING}/socket`) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  socket.binaryType = "arraybuffer";
  const closed = new Promise<number>(
    (resolve) => (socket.onclose = (event) => resolve(event.code)),
  );
  const opened = new Promise<boolean>((resolve) => {
    socket.onopen = () => resolve(true);
    socket.onerror = () => resolve(false);
  });
  return { socket, closed, opened };
}

describe("lan listener", () => {
  it("offers its address and port, and lets a known pairing's socket through", async () => {
    const t = await started();
    expect(t.onAddresses).toHaveBeenCalledWith([{ host: "127.0.0.1", port: t.port }]);
    const client = connect(t.port);
    expect(await client.opened).toBe(true);
    await vi.waitFor(() => expect(t.connections).toHaveLength(1));
    const received = new Promise<number[]>((resolve) =>
      t.connections[0]!.onMessage((b) => resolve([...b])),
    );
    client.socket.send(Uint8Array.of(9, 8));
    expect(await received).toEqual([9, 8]);
    client.socket.close();
  });

  it("refuses the wrong path, a malformed id and an unknown pairing with a 404", async () => {
    const t = await started();
    for (const path of [
      "/",
      "/v1/x/socket",
      `/v1/${"B".repeat(22)}/socket`,
      `/v1/${PAIRING}/other`,
      `/v2/${PAIRING}/socket`,
    ]) {
      expect(await connect(t.port, path).opened).toBe(false);
    }
    expect(t.connections).toHaveLength(0);
  });

  it("answers a plain HTTP request with a 404 and nothing else", async () => {
    const t = await started();
    const response = await fetch(`http://127.0.0.1:${t.port}/v1/${PAIRING}/socket`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("refuses a text frame and an oversized message on a live socket", async () => {
    const t = await started();
    const text = connect(t.port);
    await text.opened;
    text.socket.send("hi");
    expect(await text.closed).toBe(1003);
    const big = connect(t.port);
    await big.opened;
    big.socket.send(new Uint8Array(128 * 1024 + 1));
    expect(await big.closed).toBe(1009);
  });

  it("refuses the ninth socket and frees a slot when one closes", async () => {
    const t = await started();
    const clients = Array.from({ length: 8 }, () => connect(t.port));
    for (const client of clients) expect(await client.opened).toBe(true);
    expect(t.listener.sockets()).toBe(8);
    expect(await connect(t.port).opened).toBe(false);
    clients[0]!.socket.close();
    await clients[0]!.closed;
    await vi.waitFor(() => expect(t.listener.sockets()).toBe(7));
    expect(await connect(t.port).opened).toBe(true);
  });

  it("closes a socket that never completes the handshake", async () => {
    const t = await started({ handshakeTimeoutMs: 100 });
    const silent = connect(t.port);
    await silent.opened;
    expect(await silent.closed).toBe(1008);
    await vi.waitFor(() => expect(t.closed).toEqual(["transport"]));
  });

  it("keeps a socket whose handshake completed", async () => {
    const t = await started({ handshakeTimeoutMs: 100 });
    t.opened.value = true;
    const client = connect(t.port);
    await client.opened;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("never binds a wildcard, IPv6, public or link-local address, even if told it may", async () => {
    const table: InterfaceTable = {
      a: [
        iface("0.0.0.0"),
        iface("::", { family: "IPv6" }),
        iface("203.0.113.9"),
        iface("169.254.1.1"),
        iface("127.0.0.1"),
      ],
    };
    const t = await started({ listInterfaces: () => table, isAllowed: () => true });
    expect(t.listener.addresses().map((a) => a.host)).toEqual(["127.0.0.1"]);
    // It is reachable on loopback only: a connection to another local address finds nothing.
    await expect(
      new Promise((resolve, reject) => {
        const probe = net.connect(t.port, "127.0.0.2");
        probe.on("connect", () => resolve(true));
        probe.on("error", reject);
      }),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("skips an address that cannot be bound", async () => {
    const table: InterfaceTable = { a: [iface("127.0.0.1")], b: [iface("10.255.254.253")] };
    const t = await started({ listInterfaces: () => table, isAllowed: () => true });
    // Not an address of this machine: the bind fails and is skipped, the other one stays.
    expect(t.listener.addresses().map((a) => a.host)).toEqual(["127.0.0.1"]);
  });

  it("restarts when the address set changes and says so; stays put when it does not", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let table: InterfaceTable = LOOPBACK;
    const t = harness({ listInterfaces: () => table, refreshMs: 30_000 });
    running.push(t.listener);
    await t.listener.start();
    expect(t.onAddresses).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.onAddresses).toHaveBeenCalledTimes(1);
    table = {};
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.onAddresses).toHaveBeenLastCalledWith([]);
    expect(t.listener.addresses()).toEqual([]);
    table = LOOPBACK;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.listener.addresses()).toHaveLength(1);
  });

  it("stop closes the listening sockets and reports no addresses", async () => {
    const t = await started();
    const { port } = t;
    t.listener.stop();
    expect(t.onAddresses).toHaveBeenLastCalledWith([]);
    expect(await connect(port).opened).toBe(false);
  });

  it("destroys raw connections beyond twice the socket cap and frees slots when they close", async () => {
    const t = await started({ maxSockets: 2 });
    const sockets = Array.from({ length: 6 }, () => rawConnect(t.port));
    await Promise.all(sockets.map((socket) => new Promise((r) => socket.on("connect", r))));
    // The cap is 4: two connections beyond it are dropped, the rest stay open.
    await new Promise((r) => setTimeout(r, 200));
    const dropped = sockets.filter((socket) => socket.destroyed);
    expect(dropped).toHaveLength(2);
    sockets.find((socket) => !socket.destroyed)!.destroy();
    await vi.waitFor(() => expect(sockets.filter((s) => s.destroyed)).toHaveLength(3));
    // Give the server a moment to see the close and free the slot.
    await new Promise((r) => setTimeout(r, 100));
    const again = rawConnect(t.port);
    await new Promise((r) => again.on("connect", r));
    await new Promise((r) => setTimeout(r, 100));
    expect(again.destroyed).toBe(false);
    again.destroy();
    for (const socket of sockets) socket.destroy();
  });

  it("destroys a connection that never completes the upgrade", async () => {
    const t = await started({ handshakeTimeoutMs: 150 });
    const idle = rawConnect(t.port);
    await new Promise((r) => idle.on("connect", r));
    const closed = new Promise<void>((resolve) => idle.on("close", () => resolve()));
    await closed;
    expect(idle.destroyed).toBe(true);
    // A real upgrade within the deadline is not cut by the raw timer.
    t.opened.value = true;
    const client = connect(t.port);
    await client.opened;
    await new Promise((r) => setTimeout(r, 300));
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });
});
