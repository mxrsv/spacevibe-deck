/**
 * One authenticated WebSocket to the relay for one pairing (mobile design §5): the desktop's
 * side of the pipe. Binary messages are peer frames (the secure channel's business, opaque
 * here); text messages are the relay's own control protocol.
 *
 * Keeps the socket alive: `ping` every `PING_INTERVAL_MS`, reconnect after a drop with a jittered
 * 1 s → 30 s backoff. A close code that means "this pairing is over" (`revoked`, `unauthorized`,
 * `unknown`, `expired`, `claimed`) stops the loop and is reported, because retrying cannot help.
 *
 * Node's global `WebSocket` (Electron 43 main) is the default transport; the socket factory and
 * timers are injected, so every branch runs in tests with a fake socket.
 */
import { PING_INTERVAL_MS } from "../../mobile/protocol/src/limits";
import {
  errorOfCloseCode,
  pairingSocketUrl,
  parseRelayToClient,
  type ClientToRelay,
  type RelayErrorCode,
  type RelayRole,
  type RelayToClient,
} from "../../mobile/protocol/src/relay-messages";

/** The slice of the WebSocket API the client uses. */
export interface RelaySocket {
  binaryType: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type RelaySocketFactory = (url: string) => RelaySocket;

export const BACKOFF_FIRST_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

/** Why a connection will not come back on its own. */
export type RelayStop = RelayErrorCode | "revoked";

const TERMINAL: ReadonlySet<RelayStop> = new Set([
  "revoked",
  "unauthorized",
  "unknown",
  "expired",
  "claimed",
]);

export interface RelayConnectionOptions {
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly role: RelayRole;
  /** The raw token (the relay stores only its hash). */
  readonly token: string;
  readonly createSocket?: RelaySocketFactory;
  readonly random?: () => number;
  readonly onBinary: (frame: Uint8Array) => void;
  /** Fires after each `ready`, with the phone's presence. */
  readonly onReady?: (state: { peerOnline: boolean; peerLastSeen: number | null }) => void;
  readonly onPeer?: (state: { online: boolean; lastSeen: number | null }) => void;
  /** The socket is open and authenticated (`true`) or gone (`false`). */
  readonly onConnected?: (connected: boolean) => void;
  readonly onStop?: (reason: RelayStop) => void;
}

export interface RelayConnection {
  /** Opens the socket and keeps it open until `close`. */
  connect(): void;
  /** Sends one peer frame; false when the socket is not ready. */
  sendBinary(frame: Uint8Array): boolean;
  sendControl(message: ClientToRelay): boolean;
  readonly connected: boolean;
  close(): void;
}

const defaultFactory: RelaySocketFactory = (url) => {
  const Socket = (globalThis as { WebSocket?: new (target: string) => RelaySocket }).WebSocket;
  if (Socket === undefined) throw new Error("This runtime has no WebSocket client");
  return new Socket(url);
};

/** `1 s → 30 s`, doubling, with up to 25% jitter so a relay restart does not stampede. */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + random() * 0.25));
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

export function createRelayConnection(options: RelayConnectionOptions): RelayConnection {
  const createSocket = options.createSocket ?? defaultFactory;
  const random = options.random ?? Math.random;
  let socket: RelaySocket | null = null;
  let ready = false;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  /** The stop reason carried by an `error`/`revoked` message, read when the socket closes. */
  let stopReason: RelayStop | null = null;

  function setReady(next: boolean): void {
    if (ready === next) return;
    ready = next;
    options.onConnected?.(next);
  }

  function teardownSocket(): void {
    clearInterval(pingTimer);
    pingTimer = undefined;
    const old = socket;
    socket = null;
    if (old !== null) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close(1000);
      } catch {
        // Already closed.
      }
    }
    setReady(false);
  }

  function stop(reason: RelayStop): void {
    closed = true;
    clearTimeout(retryTimer);
    teardownSocket();
    options.onStop?.(reason);
  }

  function scheduleRetry(): void {
    if (closed) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, backoffDelay(attempt, random));
    retryTimer.unref?.();
    attempt += 1;
  }

  function onControl(message: RelayToClient): void {
    switch (message.t) {
      case "ready":
        attempt = 0;
        setReady(true);
        options.onReady?.({ peerOnline: message.peerOnline, peerLastSeen: message.peerLastSeen });
        return;
      case "peer":
        options.onPeer?.({ online: message.online, lastSeen: message.lastSeen });
        return;
      case "revoked":
        stopReason = "revoked";
        return;
      case "error":
        stopReason = message.code;
        return;
      case "pong":
        return;
    }
  }

  function open(): void {
    if (closed) return;
    let next: RelaySocket;
    try {
      next = createSocket(pairingSocketUrl(options.relayUrl, options.pairingId));
    } catch {
      scheduleRetry();
      return;
    }
    socket = next;
    stopReason = null;
    next.binaryType = "arraybuffer";
    next.onopen = () => {
      next.send(JSON.stringify({ t: "auth", role: options.role, token: options.token }));
      pingTimer = setInterval(() => {
        try {
          next.send(JSON.stringify({ t: "ping" }));
        } catch {
          // The close handler reconnects.
        }
      }, PING_INTERVAL_MS);
      pingTimer.unref?.();
    };
    next.onmessage = (event) => {
      if (typeof event.data === "string") {
        const message = parseRelayToClient(event.data);
        if (message !== null) onControl(message);
        return;
      }
      const bytes = toBytes(event.data);
      if (bytes !== null && ready) options.onBinary(bytes);
    };
    next.onclose = (event) => {
      const fromCode = errorOfCloseCode(event.code);
      const reason = stopReason ?? fromCode;
      if (socket === next) teardownSocket();
      if (reason !== null && TERMINAL.has(reason)) {
        stop(reason);
        return;
      }
      scheduleRetry();
    };
    next.onerror = () => {
      // `close` follows an error; reconnection is decided there.
    };
  }

  return {
    connect() {
      if (closed || socket !== null) return;
      open();
    },
    sendBinary(frame) {
      if (!ready || socket === null) return false;
      try {
        socket.send(frame);
        return true;
      } catch {
        return false;
      }
    },
    sendControl(message) {
      // Before `ready` the relay has not authenticated this socket and rejects anything else.
      if (!ready || socket === null) return false;
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    get connected() {
      return ready;
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      teardownSocket();
    },
  };
}
