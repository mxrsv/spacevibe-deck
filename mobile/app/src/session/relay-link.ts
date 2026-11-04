import { PING_INTERVAL_MS } from "@protocol/limits";
import {
  pairingSocketUrl,
  parseRelayToClient,
  RELAY_CLOSE,
  type ClientToRelay,
  type RelayErrorCode,
} from "@protocol/relay-messages";
import { CLOSE_ABNORMAL, CLOSE_NORMAL, type SocketFactory } from "./socket";

/** Why a link stopped, in the terms the connection decides on. */
export type LinkDown =
  | { readonly kind: "revoked" }
  | { readonly kind: "relay-error"; readonly code: RelayErrorCode }
  | { readonly kind: "closed"; readonly code: number };

export interface LinkHandlers {
  /** The link can carry frames. `peerOnline` is the desktop's presence (always true on a LAN link). */
  onUp(info: { readonly peerOnline: boolean; readonly peerLastSeen: number | null }): void;
  onPeer(online: boolean, lastSeen: number | null): void;
  onFrame(bytes: Uint8Array): void;
  onDown(down: LinkDown): void;
}

/**
 * A way to reach one desktop: the relay today, a direct LAN socket in T10. Both carry the same
 * binary frames for `createPhoneChannel`; only the relay has presence and `revoke`.
 */
export interface Link {
  readonly kind: "relay" | "lan";
  send(frame: Uint8Array): void;
  /** A relay control message (the push token); only the relay link has it. */
  control?(message: ClientToRelay): void;
  close(): void;
}

export type LinkKind = Link["kind"];
export type LinkFactory = (kind: LinkKind, handlers: LinkHandlers) => Link | null;

const RELAY_ERROR_BY_CLOSE = new Map<number, RelayErrorCode | "revoked">(
  Object.entries(RELAY_CLOSE).map(([code, value]) => [value, code as RelayErrorCode | "revoked"]),
);

/** The relay's text and close protocol (design §5) reduced to `LinkHandlers`. */
export function createRelayLink(options: {
  readonly socketFactory: SocketFactory;
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly phoneToken: string;
  readonly handlers: LinkHandlers;
  readonly pingIntervalMs?: number;
  /**
   * Sent right after the relay says `ready`, on every connection: push tokens rotate, so the
   * phone says again which one is current. Null sends nothing (push off or unavailable).
   */
  readonly readyMessage?: () => ClientToRelay | null;
}): Link {
  const { handlers } = options;
  let pendingError: RelayErrorCode | "revoked" | null = null;
  let open = false;
  let down = false;
  let awaitingPong = false;
  let ping: ReturnType<typeof setInterval> | null = null;

  const stopPing = (): void => {
    if (ping !== null) clearInterval(ping);
    ping = null;
  };
  const finish = (value: LinkDown): void => {
    if (down) return;
    down = true;
    open = false;
    stopPing();
    handlers.onDown(value);
  };
  const sendControl = (message: ClientToRelay): void => socket.send(JSON.stringify(message));

  const socket = options.socketFactory(pairingSocketUrl(options.relayUrl, options.pairingId), {
    onOpen() {
      open = true;
      sendControl({ t: "auth", role: "phone", token: options.phoneToken });
      ping = setInterval(() => {
        // No pong for a whole interval: the socket is half-open (a Wi-Fi to cellular handover
        // leaves it dangling), so drop it and let the connection reconnect.
        if (awaitingPong) {
          socket.close(CLOSE_NORMAL, "pong-timeout");
          finish({ kind: "closed", code: CLOSE_ABNORMAL });
          return;
        }
        awaitingPong = true;
        sendControl({ t: "ping" });
      }, options.pingIntervalMs ?? PING_INTERVAL_MS);
    },
    onText(text) {
      const message = parseRelayToClient(text);
      if (message === null) return; // a newer relay dialect: ignore, never guess
      switch (message.t) {
        case "ready": {
          const extra = options.readyMessage?.() ?? null;
          if (extra !== null) sendControl(extra);
          handlers.onUp({ peerOnline: message.peerOnline, peerLastSeen: message.peerLastSeen });
          break;
        }
        case "peer":
          handlers.onPeer(message.online, message.lastSeen);
          break;
        case "revoked":
          pendingError = "revoked";
          break;
        case "error":
          pendingError = message.code;
          break;
        case "pong":
          awaitingPong = false;
          break;
      }
    },
    onBinary: (bytes) => handlers.onFrame(bytes),
    onClose(code) {
      const named = pendingError ?? RELAY_ERROR_BY_CLOSE.get(code) ?? null;
      if (named === "revoked") finish({ kind: "revoked" });
      else if (named !== null) finish({ kind: "relay-error", code: named });
      else finish({ kind: "closed", code });
    },
  });

  return {
    kind: "relay",
    send(frame) {
      if (open && !down) socket.send(frame);
    },
    control(message) {
      if (open && !down) sendControl(message);
    },
    close() {
      if (down) return;
      // Silence further callbacks: the owner closed this link on purpose.
      down = true;
      open = false;
      stopPing();
      socket.close(CLOSE_NORMAL, "client-close");
    },
  };
}
