/**
 * Pairing, the desktop's side (mobile design §3, MOB1-3, MOB5): create a pairing and its QR,
 * register it with the relay, accept exactly one valid `pair-hello` before it expires, list the
 * paired phones and revoke one.
 *
 * The cryptography is `mobile/protocol/src/pairing.ts`; this module owns the lifecycle: one
 * pending pairing at a time, the 5-minute expiry (checked again when the hello arrives), the
 * `safeStorage` record, and the relay registration through an injected `fetch`. It does not own
 * sockets: the service opens a relay connection for the pending pairing and hands every binary
 * frame to `handleFrame`, which returns the frame to send back.
 */
import { hostname } from "node:os";
import type { CryptoProvider } from "../../mobile/protocol/src/crypto";
import { b64urlEncode, randomId } from "../../mobile/protocol/src/encoding";
import { PAIRING_TTL_MS } from "../../mobile/protocol/src/limits";
import {
  acceptPairHello,
  rejectFrame,
  type DesktopInfo,
  type PendingPairing,
} from "../../mobile/protocol/src/pairing";
import { deriveClaimToken } from "../../mobile/protocol/src/keys";
import { encodePairingQr, sanitizeDesktopName } from "../../mobile/protocol/src/qr";
import { pairingRegistrationUrl } from "../../mobile/protocol/src/relay-messages";
import type { PairingStore, StoredPairing, StoreRefusal } from "./pairing-store";

export type PairStartFailure =
  StoreRefusal | "no-relay" | "relay-unreachable" | "relay-rejected" | "busy";

/** The sentences Settings shows for a pairing that cannot start (MOB3: visible reasons). */
export const PAIR_FAILURE_TEXT: Readonly<Record<PairStartFailure, string>> = {
  "encryption-unavailable":
    "This computer cannot protect pairing keys (secure storage is unavailable), so phones cannot be paired.",
  unreadable:
    "The saved list of paired phones could not be read, so Deck will not replace it. Remove mobile-pairings.json from Deck's data folder to start over.",
  "no-relay": "The relay address is not valid.",
  "relay-unreachable": "Deck could not reach the relay. Check the connection and try again.",
  "relay-rejected": "The relay refused the pairing. Try again in a moment.",
  busy: "A pairing is already waiting for a phone.",
};

export interface PendingView {
  readonly pairingId: string;
  readonly qr: string;
  readonly expiresAt: number;
  readonly relayUrl: string;
  /** The token the relay socket for this pairing authenticates with. */
  readonly desktopToken: string;
}

export type PairStartResult =
  | { readonly ok: true; readonly pending: PendingView }
  | { readonly ok: false; readonly reason: PairStartFailure };

export interface PhoneSummary {
  readonly pairingId: string;
  readonly name: string;
  readonly model: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number | null;
}

export interface PairingService {
  start(): Promise<PairStartResult>;
  cancel(): void;
  pending(): PendingView | null;
  /**
   * A binary frame that arrived on the pending pairing's relay socket. Returns the frame to send
   * back, or null when the frame belongs to no pending pairing (a session `hello`, say).
   */
  handleFrame(pairingId: string, frame: Uint8Array): Promise<Uint8Array | null>;
  phones(): readonly PhoneSummary[];
  /** Deletes the local record. The service then tells the relay and closes the sessions. */
  revoke(pairingId: string): Promise<boolean>;
}

export interface PairingDeps {
  readonly crypto: CryptoProvider;
  readonly store: PairingStore;
  readonly relayUrl: () => string | null;
  readonly fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number }>;
  readonly appVersion: string;
  readonly platform: NodeJS.Platform;
  readonly now?: () => number;
  /** The pending pairing appeared, expired or was cancelled. */
  readonly onPendingChanged: () => void;
  /** A phone paired; the service attaches its channel. */
  readonly onPaired: (record: StoredPairing) => void;
  /** A revoke removed the record; the service closes sessions and tells the relay. */
  readonly onRevoked: (record: StoredPairing) => void;
  readonly hostName?: () => string;
}

/** The computer name a phone shows: the hostname without a `.local` tail, control characters out. */
export function desktopName(host: string): string {
  return sanitizeDesktopName(host.replace(/\.(local|lan|home)$/i, ""));
}

function osName(platform: NodeJS.Platform): DesktopInfo["os"] {
  return platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";
}

export function createPairingService(deps: PairingDeps): PairingService {
  const now = deps.now ?? Date.now;
  const hostName = deps.hostName ?? hostname;
  let current: { view: PendingView; secrets: PendingPairing } | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  function clear(): boolean {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    const had = current !== null;
    current = null;
    return had;
  }

  function currentIfLive(): typeof current {
    if (current !== null && now() >= current.view.expiresAt) {
      clear();
      deps.onPendingChanged();
    }
    return current;
  }

  return {
    async start() {
      if (currentIfLive() !== null) return { ok: false, reason: "busy" };
      const refusal = await deps.store.refusal();
      if (refusal !== null) return { ok: false, reason: refusal };
      const relayUrl = deps.relayUrl();
      if (relayUrl === null) return { ok: false, reason: "no-relay" };

      const { crypto } = deps;
      const pairingId = randomId(crypto);
      const secret = crypto.randomBytes(32);
      const desktopTokenBytes = crypto.randomBytes(32);
      const desktopToken = b64urlEncode(desktopTokenBytes);
      const keys = crypto.x25519KeyPair();
      const expiresAt = now() + PAIRING_TTL_MS;
      const claimToken = deriveClaimToken(crypto, secret);

      try {
        const response = await deps.fetch(pairingRegistrationUrl(relayUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pairingId,
            desktopTokenHash: b64urlEncode(crypto.sha256(desktopTokenBytes)),
            claimHash: b64urlEncode(crypto.sha256(claimToken)),
            expiresAt,
          }),
        });
        if (response.status !== 201) return { ok: false, reason: "relay-rejected" };
      } catch {
        return { ok: false, reason: "relay-unreachable" };
      }
      // A second start() may have won while the relay call was in flight.
      if (currentIfLive() !== null) return { ok: false, reason: "busy" };

      const qr = encodePairingQr({
        relayUrl,
        pairingId,
        desktopPublicKey: keys.publicKey,
        secret,
        expiresAt,
        desktopName: desktopName(hostName()),
      });
      const view: PendingView = { pairingId, qr, expiresAt, relayUrl, desktopToken };
      current = {
        view,
        secrets: {
          pairingId,
          secret,
          desktopSecretKey: keys.secretKey,
          desktopPublicKey: keys.publicKey,
          expiresAt,
          used: false,
        },
      };
      expiryTimer = setTimeout(() => {
        if (clear()) deps.onPendingChanged();
      }, expiresAt - now());
      expiryTimer.unref?.();
      deps.onPendingChanged();
      return { ok: true, pending: view };
    },

    cancel() {
      if (clear()) deps.onPendingChanged();
    },

    pending: () => currentIfLive()?.view ?? null,

    async handleFrame(pairingId, frame) {
      const live = currentIfLive();
      if (live === null || live.view.pairingId !== pairingId) return null;
      // Frame type 0x10 only; a session `hello` on this socket is not ours to answer.
      if (frame[0] !== 0x10) return null;
      const result = acceptPairHello(deps.crypto, live.secrets, frame, now(), {
        name: desktopName(hostName()),
        os: osName(deps.platform),
        appVersion: deps.appVersion,
      });
      if (!result.ok) return result.reply;
      // Mark used before the (async) save, so a second hello racing it is refused.
      current = { view: live.view, secrets: result.pending };
      const record: StoredPairing = {
        pairingId,
        relayUrl: live.view.relayUrl,
        phoneName: result.phone.name,
        phoneModel: result.phone.model,
        pairedAt: now(),
        lastSeenAt: now(),
        dsk: b64urlEncode(live.secrets.desktopSecretKey),
        ppk: b64urlEncode(result.phonePublicKey),
        pairKey: b64urlEncode(result.pairKey),
        desktopToken: live.view.desktopToken,
      };
      const saved = await deps.store.add(record);
      if (!saved.ok) {
        clear();
        deps.onPendingChanged();
        return rejectFrame("unknown");
      }
      clear();
      deps.onPaired(record);
      deps.onPendingChanged();
      return result.reply;
    },

    phones: () =>
      deps.store.list().map((record) => ({
        pairingId: record.pairingId,
        name: record.phoneName,
        model: record.phoneModel,
        pairedAt: record.pairedAt,
        lastSeenAt: record.lastSeenAt,
      })),

    async revoke(pairingId) {
      const record = deps.store.get(pairingId);
      if (record === null) return false;
      if (!(await deps.store.remove(pairingId))) return false;
      deps.onRevoked(record);
      return true;
    },
  };
}
