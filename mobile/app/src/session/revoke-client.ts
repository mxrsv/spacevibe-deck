import { pairingSocketUrl, parseRelayToClient, RELAY_CLOSE } from "@protocol/relay-messages";
import { CLOSE_NORMAL, type SocketFactory } from "./socket";

export const REVOKE_TIMEOUT_MS = 8_000;

/**
 * Tells the relay to delete this pairing everywhere (MOB2), on a socket of its own so it works
 * whether or not the desktop's connection is up. Resolves true when the relay no longer holds the
 * pairing, false when it could not be confirmed (offline, refused, timed out): the caller still
 * forgets the keys locally, and says the desktop may need removing by hand.
 */
export function revokeOnRelay(options: {
  readonly socketFactory: SocketFactory;
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly phoneToken: string;
  readonly timeoutMs?: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close(CLOSE_NORMAL, "revoke-finished");
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), options.timeoutMs ?? REVOKE_TIMEOUT_MS);
    const socket = options.socketFactory(pairingSocketUrl(options.relayUrl, options.pairingId), {
      onOpen() {
        socket.send(JSON.stringify({ t: "auth", role: "phone", token: options.phoneToken }));
      },
      onText(text) {
        const message = parseRelayToClient(text);
        if (message === null) return;
        if (message.t === "ready") socket.send(JSON.stringify({ t: "revoke" }));
        else if (message.t === "revoked") finish(true);
        // An unknown pairing is already gone from the relay, which is what the user asked for.
        else if (message.t === "error") finish(message.code === "unknown");
      },
      onBinary() {},
      onClose(code) {
        finish(code === RELAY_CLOSE.revoked || code === RELAY_CLOSE.unknown);
      },
    });
  });
}
