import type { LanAddress } from "@protocol/messages";
import { lanSocketUrl } from "./lan-addresses";
import type { Link, LinkHandlers } from "./relay-link";
import { CLOSE_ABNORMAL, CLOSE_NORMAL, type SocketFactory } from "./socket";

/** A LAN address that does not answer this fast is not on this network. */
export const LAN_CONNECT_TIMEOUT_MS = 2_000;

/**
 * The direct path (MOB9): binary peer frames over a WebSocket to the desktop's LAN listener. There
 * is no relay protocol here: no `auth`, no presence, no control messages (the desktop refuses text
 * frames). The socket opening is the link being up; the secure channel on top proves who is there.
 */
export function createLanLink(options: {
  readonly socketFactory: SocketFactory;
  readonly address: LanAddress;
  readonly pairingId: string;
  readonly handlers: LinkHandlers;
  readonly connectTimeoutMs?: number;
}): Link {
  const { handlers } = options;
  let open = false;
  let down = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = (code: number): void => {
    if (down) return;
    down = true;
    open = false;
    if (timer !== null) clearTimeout(timer);
    handlers.onDown({ kind: "closed", code });
  };

  const socket = options.socketFactory(lanSocketUrl(options.address, options.pairingId), {
    onOpen() {
      if (down) return;
      open = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      handlers.onUp({ peerOnline: true, peerLastSeen: null });
    },
    onText() {
      // The LAN protocol is binary only; a text frame is not ours.
    },
    onBinary: (bytes) => handlers.onFrame(bytes),
    onClose: (code) => finish(code),
  });
  timer = setTimeout(() => {
    if (open) return;
    socket.close(CLOSE_NORMAL, "connect-timeout");
    finish(CLOSE_ABNORMAL);
  }, options.connectTimeoutMs ?? LAN_CONNECT_TIMEOUT_MS);

  return {
    kind: "lan",
    send(frame) {
      if (open && !down) socket.send(frame);
    },
    close() {
      if (down) return;
      down = true;
      open = false;
      if (timer !== null) clearTimeout(timer);
      socket.close(CLOSE_NORMAL, "client-close");
    },
  };
}
