// Test support: a relay and a desktop in one object, behind the same `SocketFactory` the app uses,
// speaking the real protocol code from `mobile/protocol` on the desktop side (a node:crypto
// provider, so every test is also an interoperability check against the phone's noble provider).
import { createDesktopChannel, type DesktopChannel, type VersionRange } from "@protocol/channel";
import type { CryptoProvider } from "@protocol/crypto";
import { b64urlEncode } from "@protocol/encoding";
import { FRAME_TYPE } from "@protocol/frames";
import { deriveClaimToken } from "@protocol/keys";
import { parseAppMessage } from "@protocol/messages";
import { acceptPairHello, type DesktopInfo, type PendingPairing } from "@protocol/pairing";
import { encodePairingQr, type PairingQr } from "@protocol/qr";
import { parseClientToRelay, RELAY_CLOSE, type RelayErrorCode } from "@protocol/relay-messages";
import type { PhoneSocket, SocketEvents, SocketFactory } from "@/session/socket";

export interface FakeSocket {
  readonly url: string;
  readonly events: SocketEvents;
  readonly sent: (string | Uint8Array)[];
  authed: boolean;
  closedWith: number | null;
}

export interface FakeWorldOptions {
  readonly crypto: CryptoProvider;
  readonly pairingId: string;
  readonly phoneToken: string;
  readonly pairKey?: Uint8Array;
  readonly desktopVersion?: VersionRange;
  readonly pending?: PendingPairing;
  readonly claimToken?: string;
  /** LAN addresses the desktop offers in its `desktop` event and answers on. */
  readonly lan?: readonly { host: string; port: number }[];
}

const DESKTOP_INFO: DesktopInfo = { name: "Studio Mac", os: "macos", appVersion: "9.9.9" };

export function createFakeWorld(options: FakeWorldOptions) {
  const { crypto } = options;
  const sockets: FakeSocket[] = [];
  const requests: { id: number; m: string; p: unknown }[] = [];
  let desktopOnline = true;
  let lastSeen: number | null = 1_700_000_000_000;
  const channels = new Map<FakeSocket, DesktopChannel>();
  let lanOffered = [...(options.lan ?? [])];
  const lanReachable = new Set(lanOffered.map((a) => `${a.host}:${a.port}`));
  let pending = options.pending ?? null;
  let silent = false;
  let revoked = false;

  const text = (socket: FakeSocket, message: object): void => {
    queueMicrotask(() => {
      if (socket.closedWith === null) socket.events.onText(JSON.stringify(message));
    });
  };
  const closeFromRelay = (socket: FakeSocket, code: number): void => {
    queueMicrotask(() => {
      if (socket.closedWith !== null) return;
      socket.closedWith = code;
      socket.events.onClose(code, "");
    });
  };
  const fail = (socket: FakeSocket, code: RelayErrorCode): void => {
    text(socket, { t: "error", code });
    closeFromRelay(socket, RELAY_CLOSE[code]);
  };
  // Frames cross a real network asynchronously; delivering them inline would let the phone answer
  // a `welcome` before the desktop has finished deriving its keys, which no real socket can do.
  const toPhone = (socket: FakeSocket, frame: Uint8Array): void => {
    queueMicrotask(() => {
      if (socket.closedWith === null) socket.events.onBinary(frame);
    });
  };

  function openDesktopChannel(socket: FakeSocket): DesktopChannel {
    const pairKey = options.pairKey;
    const next = createDesktopChannel({
      crypto,
      lookup: (id) => (id === options.pairingId && pairKey !== undefined ? pairKey : null),
      send: (frame) => toPhone(socket, frame),
      local: options.desktopVersion,
    });
    next.onState((state) => {
      if (state === "open" && !silent) {
        next.sendMessage({
          ev: "desktop",
          p: { name: "Studio Mac", os: "macos", appVersion: "9.9.9", protocol: 1, lan: lanOffered },
        });
      }
    });
    next.onMessage((raw) => {
      const message = parseAppMessage(raw);
      if (message?.kind === "request") {
        requests.push(message.request);
        const { id, m } = message.request;
        if (m === "usage.get") next.sendMessage({ id, ok: true, r: { usage: { today: 1 } } });
        else if (m === "tree.subscribe")
          next.sendMessage({ id, ok: true, r: { tree: { projects: [] } } });
        else if (m === "pane.input")
          return; // never answered: lets a test observe a timeout
        else next.sendMessage({ id, ok: false, e: { code: "unavailable", message: "not now" } });
      }
    });
    return next;
  }

  function fromPhoneBinary(socket: FakeSocket, bytes: Uint8Array): void {
    if (!desktopOnline) return;
    if (bytes[0] === FRAME_TYPE.pairHello) {
      const result = acceptPairHello(crypto, pending, bytes, Date.now(), DESKTOP_INFO);
      if (result.ok) pending = result.pending;
      toPhone(socket, result.reply);
      return;
    }
    let channel = channels.get(socket);
    if (channel === undefined || channel.state === "closed") {
      channel = openDesktopChannel(socket);
      channels.set(socket, channel);
    }
    channel.receive(bytes);
  }

  function fromPhoneText(socket: FakeSocket, data: string): void {
    const message = parseClientToRelay(data, 4096);
    if (message === null) return;
    if (message.t === "auth") {
      if (revoked) return fail(socket, "unknown");
      if (message.token !== options.phoneToken) return fail(socket, "unauthorized");
      socket.authed = true;
      text(socket, {
        t: "ready",
        role: "phone",
        peerOnline: desktopOnline,
        peerLastSeen: lastSeen,
      });
    } else if (message.t === "claim") {
      if (pending === null) return fail(socket, "unknown");
      if (pending.used) return fail(socket, "claimed");
      if (message.claimToken !== b64urlEncode(deriveClaimToken(crypto, pending.secret))) {
        return fail(socket, "unauthorized");
      }
      socket.authed = true;
      text(socket, {
        t: "ready",
        role: "phone",
        peerOnline: desktopOnline,
        peerLastSeen: lastSeen,
      });
    } else if (message.t === "ping") {
      text(socket, { t: "pong" });
    } else if (message.t === "revoke" && socket.authed) {
      revoked = true;
      text(socket, { t: "revoked" });
      closeFromRelay(socket, RELAY_CLOSE.revoked);
    }
  }

  const socketFactory: SocketFactory = (url, events) => {
    const socket: FakeSocket = { url, events, sent: [], authed: false, closedWith: null };
    sockets.push(socket);
    queueMicrotask(() => {
      if (socket.closedWith === null) events.onOpen();
    });
    const handle: PhoneSocket = {
      send(data) {
        if (socket.closedWith !== null) return;
        socket.sent.push(data);
        queueMicrotask(() => {
          if (socket.closedWith !== null) return;
          if (typeof data === "string") fromPhoneText(socket, data);
          else fromPhoneBinary(socket, data);
        });
      },
      close(code = 1000) {
        if (socket.closedWith !== null) return;
        socket.closedWith = code;
        queueMicrotask(() => events.onClose(code, ""));
      },
    };
    return handle;
  };

  const lanSockets: FakeSocket[] = [];
  /** The desktop's LAN listener: binary frames only, a path of `/v1/<pairingId>/socket`. */
  const lanSocketFactory: SocketFactory = (url, events) => {
    const socket: FakeSocket = { url, events, sent: [], authed: true, closedWith: null };
    lanSockets.push(socket);
    const match = /^ws:\/\/([^:/]+):(\d+)\/v1\/([^/]+)\/socket$/.exec(url);
    const reachable =
      match !== null &&
      lanReachable.has(`${match[1]}:${match[2]}`) &&
      match[3] === options.pairingId;
    if (reachable) {
      queueMicrotask(() => {
        if (socket.closedWith === null) events.onOpen();
      });
    }
    return {
      send(data) {
        if (socket.closedWith !== null || typeof data === "string") return; // text is refused on the LAN path
        socket.sent.push(data);
        queueMicrotask(() => {
          if (socket.closedWith === null) fromPhoneBinary(socket, data);
        });
      },
      close(code = 1000) {
        if (socket.closedWith !== null) return;
        socket.closedWith = code;
        queueMicrotask(() => events.onClose(code, ""));
      },
    };
  };

  return {
    socketFactory,
    sockets,
    requests,
    get live(): FakeSocket[] {
      return sockets.filter((s) => s.closedWith === null);
    },
    get channel(): DesktopChannel | null {
      return [...channels.values()].at(-1) ?? null;
    },
    get channelCount(): number {
      return [...channels.values()].filter((c) => c.state !== "closed").length;
    },
    get pending(): PendingPairing | null {
      return pending;
    },
    /** The desktop connects to or leaves the relay; the phone hears it as a `peer` message. */
    setDesktopOnline(online: boolean, seen: number | null = lastSeen): void {
      desktopOnline = online;
      lastSeen = seen;
      if (!online) for (const c of channels.values()) c.close("desktop-left");
      for (const socket of sockets)
        if (socket.authed) text(socket, { t: "peer", online, lastSeen: seen });
    },
    /** The relay (or the network) drops every phone socket. */
    dropAll(code: number): void {
      for (const socket of sockets) closeFromRelay(socket, code);
    },
    /** The desktop opens the session but never answers: a desktop that cannot read `session.start`. */
    goSilent(): void {
      silent = true;
    },
    sendEvent(message: object): void {
      for (const c of channels.values()) if (c.state === "open") c.sendMessage(message);
    },
    /** The desktop's addresses changed: it tells every open session (the `desktop` event again). */
    announceLan(addresses: readonly { host: string; port: number }[]): void {
      lanOffered = [...addresses];
      for (const a of addresses) lanReachable.add(`${a.host}:${a.port}`);
      this.sendEvent({
        ev: "desktop",
        p: { name: "Studio Mac", os: "macos", appVersion: "9.9.9", protocol: 1, lan: lanOffered },
      });
    },
    /** Make a LAN address answer (or stop answering: its sockets then never open). */
    setLanReachable(host: string, port: number, reachable: boolean): void {
      if (reachable) lanReachable.add(`${host}:${port}`);
      else lanReachable.delete(`${host}:${port}`);
    },
    /** The LAN listener drops every LAN socket (the phone left the network). */
    dropLan(): void {
      for (const socket of lanSockets) closeFromRelay(socket, 1006);
    },
    lanSockets,
    lanSocketFactory,
  };
}

/** A desktop-side QR the phone can scan, with the pending record the fake desktop judges it by. */
export function createQr(
  crypto: CryptoProvider,
  overrides: Partial<PairingQr> & { readonly now: number },
): { readonly qr: PairingQr; readonly text: string; readonly pending: PendingPairing } {
  const keys = crypto.x25519KeyPair();
  const secret = crypto.randomBytes(32);
  const pairingId = b64urlEncode(crypto.randomBytes(16));
  const qr: PairingQr = {
    relayUrl: "https://relay.test/relay",
    pairingId,
    desktopPublicKey: keys.publicKey,
    secret,
    expiresAt: overrides.now + 300_000,
    desktopName: "Studio Mac",
    ...overrides,
  };
  return {
    qr,
    text: encodePairingQr(qr),
    pending: {
      pairingId: qr.pairingId,
      secret,
      desktopSecretKey: keys.secretKey,
      desktopPublicKey: keys.publicKey,
      expiresAt: qr.expiresAt,
      used: false,
    },
  };
}
