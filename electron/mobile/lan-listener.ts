/**
 * The LAN path (MOB9, plan fork F6): a WebSocket listener that lets a phone on the same Wi-Fi reach
 * the desktop directly. It carries the same secure channel as the relay; this module only decides
 * who may open a socket and for how long.
 *
 * Why it is narrow:
 * - **Never a public interface.** A listener on `0.0.0.0` would answer on every interface. We
 *   bind each RFC 1918 IPv4 address on its own and never a wildcard, never IPv6 (no private-range
 *   rule is as simple to state), never link-local, CGNAT (shared carrier space) or loopback. The
 *   check runs again at bind time, whatever the caller injected. Private does not mean trusted:
 *   10/8 and 192.168/16 include café, hotel and office networks, so any host on them can reach the
 *   port. The protection is the pairing key (the channel proves it) plus the limits below.
 * - **Only a known pairing.** The path carries the pairing id; an unknown or malformed one is a
 *   404, the same answer as any other path, so a scanner learns nothing. The secure channel still
 *   proves the phone holds the pairing key; the path check just keeps strangers from costing a
 *   handshake.
 * - **Bounded.** Raw TCP connections are capped at twice the socket cap, and one that has not
 *   completed the upgrade within the handshake deadline is destroyed: idle connections that never
 *   send a request would otherwise exhaust the process's file descriptors, which PTY spawns and
 *   file saves share. `LAN_MAX_SOCKETS` sockets in total (a ninth gets a 503), and a socket that has
 *   not opened the channel within `LAN_HANDSHAKE_TIMEOUT_MS` is closed. Messages are capped at
 *   `RELAY_MAX_FRAME_BYTES`.
 * - **Silent over HTTP.** Anything that is not the upgrade is a 404 with no body.
 */
import http from "node:http";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { Duplex } from "node:stream";
import {
  LAN_HANDSHAKE_TIMEOUT_MS,
  LAN_MAX_SOCKETS,
  RELAY_MAX_FRAME_BYTES,
} from "../../mobile/protocol/src/limits";
import type { LanAddress } from "../../mobile/protocol/src/messages";
import { isPairingId } from "../../mobile/protocol/src/relay-messages";
import { acceptUpgrade, refuseUpgrade, WS_CLOSE, type WsConnection } from "./ws-server";

export const LAN_REFRESH_MS = 30_000;
const PATH = /^\/v1\/([^/?#]+)\/socket$/;

export type InterfaceTable = Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>;

/** 10/8, 172.16/12, 192.168/16. Not loopback, link-local, CGNAT or public. */
export function isPrivateLanAddress(address: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The private IPv4 addresses of the machine's non-internal interfaces, sorted and unique. */
export function privateLanAddresses(
  table: InterfaceTable,
  allowed: (address: string) => boolean = isPrivateLanAddress,
): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(table)) {
    for (const entry of entries ?? []) {
      // `family` is a string on current Node and a number on a few older releases.
      const v4 = entry.family === "IPv4" || (entry.family as unknown) === 4;
      if (v4 && !entry.internal && allowed(entry.address)) found.add(entry.address);
    }
  }
  return [...found].sort();
}

/** What a session needs from the transport: the session closes it, the transport ends the session. */
export interface LanSessionHandle {
  /** Whether the secure channel finished its handshake. */
  isOpen(): boolean;
  /** The transport went away. */
  close(reason: string): void;
}

export interface LanListenerDeps {
  readonly isKnown: (pairingId: string) => boolean;
  /** Hands an accepted socket to the desktop session code (the same one the relay path uses). */
  readonly openSession: (pairingId: string, connection: WsConnection) => LanSessionHandle;
  /** Called when the set of offered addresses changes (including to empty). */
  readonly onAddresses: (addresses: readonly LanAddress[]) => void;
  readonly log: (message: string) => void;
  readonly listInterfaces?: () => InterfaceTable;
  /** Defaults to the private-range rule; a test widens it to bind loopback. */
  readonly isAllowed?: (address: string) => boolean;
  readonly maxSockets?: number;
  readonly handshakeTimeoutMs?: number;
  readonly refreshMs?: number;
}

export interface LanListener {
  start(): Promise<void>;
  stop(): void;
  addresses(): readonly LanAddress[];
  /** Live sockets, handshaken or not. */
  sockets(): number;
}

/** The two things never bound, whatever else a caller allows. */
function isBindable(address: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address) && address !== "0.0.0.0";
}

function listenOn(server: http.Server, port: number, address: string): Promise<number | null> {
  return new Promise((resolve) => {
    const onError = () => resolve(null);
    server.once("error", onError);
    server.listen(port, address, () => {
      server.off("error", onError);
      const bound = server.address();
      resolve(typeof bound === "object" && bound !== null ? bound.port : null);
    });
  });
}

export function createLanListener(deps: LanListenerDeps): LanListener {
  const maxSockets = deps.maxSockets ?? LAN_MAX_SOCKETS;
  const handshakeMs = deps.handshakeTimeoutMs ?? LAN_HANDSHAKE_TIMEOUT_MS;
  const listInterfaces = deps.listInterfaces ?? (() => networkInterfaces() as InterfaceTable);
  const allowed = deps.isAllowed ?? isPrivateLanAddress;

  let servers: http.Server[] = [];
  let offered: LanAddress[] = [];
  let addressKey = "";
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  // Refreshes run one at a time, so two binds never interleave.
  let queue: Promise<void> = Promise.resolve();
  let live = 0;
  // Raw TCP connections of every server, upgraded or not; the file-descriptor guard.
  let raw = 0;
  const preUpgrade = new WeakMap<Duplex, NodeJS.Timeout>();

  function onConnection(socket: Duplex): void {
    if (raw >= maxSockets * 2) {
      socket.destroy();
      return;
    }
    raw += 1;
    const timer = setTimeout(() => socket.destroy(), handshakeMs);
    timer.unref();
    preUpgrade.set(socket, timer);
    socket.once("close", () => {
      clearTimeout(timer);
      raw -= 1;
    });
    socket.on("error", () => socket.destroy());
  }

  function onUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    // Past the raw deadline: from here `refuseUpgrade` and the handshake deadline own the socket.
    const pending = preUpgrade.get(socket);
    if (pending !== undefined) clearTimeout(pending);
    socket.on("error", () => socket.destroy());
    const pairingId = PATH.exec((request.url ?? "").split("?")[0] ?? "")?.[1];
    if (pairingId === undefined || !isPairingId(pairingId) || !deps.isKnown(pairingId)) {
      refuseUpgrade(socket, 404);
      return;
    }
    if (live >= maxSockets) {
      refuseUpgrade(socket, 503);
      return;
    }
    const connection = acceptUpgrade(request, socket, head, {
      maxMessageBytes: RELAY_MAX_FRAME_BYTES,
    });
    if (connection === null) return;
    live += 1;
    const handle = deps.openSession(pairingId, connection);
    const deadline = setTimeout(() => {
      if (!handle.isOpen()) connection.close(WS_CLOSE.policy, "handshake timeout");
    }, handshakeMs);
    deadline.unref();
    connection.onClose(() => {
      clearTimeout(deadline);
      live -= 1;
      handle.close("transport");
    });
  }

  function onRequest(_request: http.IncomingMessage, response: http.ServerResponse): void {
    response.writeHead(404, { Connection: "close", "Content-Length": "0" });
    response.end();
  }

  function closeServers(): void {
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
    servers = [];
  }

  async function bind(addresses: readonly string[]): Promise<LanAddress[]> {
    const bound: LanAddress[] = [];
    let port = 0;
    for (const address of addresses) {
      if (!isBindable(address) || !allowed(address)) continue;
      const server = http.createServer(onRequest);
      server.maxHeadersCount = 64;
      server.headersTimeout = handshakeMs;
      server.requestTimeout = handshakeMs;
      server.on("connection", onConnection);
      server.on("upgrade", onUpgrade);
      // One port for every address if it is free there; an address that cannot take it is skipped.
      const actual = await listenOn(server, port, address);
      if (actual === null) {
        server.close();
        deps.log(`Deck: the LAN listener could not bind ${address}`);
        continue;
      }
      if (port === 0) port = actual;
      servers.push(server);
      bound.push({ host: address, port: actual });
    }
    return bound;
  }

  async function refreshNow(): Promise<void> {
    if (!running) return;
    const next = privateLanAddresses(listInterfaces(), allowed);
    const key = next.join(",");
    if (key === addressKey) return;
    closeServers();
    addressKey = key;
    const bound = await bind(next);
    if (!running) {
      // Stopped while binding.
      closeServers();
      return;
    }
    offered = bound;
    deps.onAddresses(offered);
  }

  function refresh(): Promise<void> {
    queue = queue.then(refreshNow, refreshNow);
    return queue;
  }

  return {
    async start() {
      if (running) return;
      running = true;
      await refresh();
      timer = setInterval(() => void refresh(), deps.refreshMs ?? LAN_REFRESH_MS);
      timer.unref();
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer !== null) clearInterval(timer);
      timer = null;
      closeServers();
      addressKey = "";
      if (offered.length > 0) {
        offered = [];
        deps.onAddresses(offered);
      }
    },
    addresses: () => offered,
    sockets: () => live,
  };
}
