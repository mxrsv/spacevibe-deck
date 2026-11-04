/**
 * The pairing exchange (design §3.5–3.6), as pure functions for both ends. The phone proves it saw
 * the QR by sealing its details under a key only the QR's `secret` and the two static keys can
 * produce; the desktop accepts that proof once.
 */
import type { CryptoProvider } from "./crypto";
import { displayText } from "./display-text";
import { utf8Decode, utf8Encode } from "./encoding";
import { decodeFrame, encodeFrame, type PairRejectReason } from "./frames";
import { AAD_PAIR_ACCEPT, AAD_PAIR_HELLO, derivePairBoxKeys, derivePairKey } from "./keys";
import type { PairingQr } from "./qr";
import { isRecord, isSafeNonNegative, parseJsonText } from "./validate";

/** Each pair box key seals one message, so a constant nonce never repeats under a key. */
const ZERO_NONCE = new Uint8Array(12);

export interface PhoneInfo {
  readonly name: string;
  readonly model: string;
  readonly os: string;
  /** The protocol version the phone speaks. */
  readonly v: number;
}
export interface DesktopInfo {
  readonly name: string;
  readonly os: string;
  readonly appVersion: string;
}

export interface PhonePairAttempt {
  /** Send this as one binary message to the desktop. */
  readonly frame: Uint8Array;
  readonly phoneSecretKey: Uint8Array;
  readonly phonePublicKey: Uint8Array;
  readonly pairKey: Uint8Array;
}

export function createPairHello(
  crypto: CryptoProvider,
  qr: PairingQr,
  phone: PhoneInfo,
): PhonePairAttempt {
  const { secretKey, publicKey } = crypto.x25519KeyPair();
  const pairKey = derivePairKey(crypto, {
    ownSecretKey: secretKey,
    peerPublicKey: qr.desktopPublicKey,
    secret: qr.secret,
    pairingId: qr.pairingId,
  });
  const { p2d } = derivePairBoxKeys(crypto, pairKey);
  const plaintext = utf8Encode(
    JSON.stringify({ name: phone.name, model: phone.model, os: phone.os, v: phone.v }),
  );
  const box = crypto.seal(p2d, ZERO_NONCE, plaintext, utf8Encode(AAD_PAIR_HELLO));
  return {
    frame: encodeFrame({ type: "pair-hello", phonePublicKey: publicKey, box }),
    phoneSecretKey: secretKey,
    phonePublicKey: publicKey,
    pairKey,
  };
}

export type PairAcceptResult =
  | { readonly ok: true; readonly desktop: DesktopInfo }
  | { readonly ok: false; readonly reason: PairRejectReason | "malformed" };

/** The phone's reading of the desktop's answer: its details, a refusal, or garbage. */
export function openPairAccept(
  crypto: CryptoProvider,
  attempt: Pick<PhonePairAttempt, "pairKey">,
  frameBytes: Uint8Array,
): PairAcceptResult {
  const frame = decodeFrame(frameBytes);
  if (frame === null) return { ok: false, reason: "malformed" };
  if (frame.type === "pair-reject") return { ok: false, reason: frame.reason };
  if (frame.type !== "pair-accept") return { ok: false, reason: "malformed" };
  const { d2p } = derivePairBoxKeys(crypto, attempt.pairKey);
  const plaintext = crypto.open(d2p, ZERO_NONCE, frame.box, utf8Encode(AAD_PAIR_ACCEPT));
  if (plaintext === null) return { ok: false, reason: "bad-proof" };
  const info = parseJsonSafely(plaintext);
  if (
    info === null ||
    typeof info.name !== "string" ||
    typeof info.os !== "string" ||
    typeof info.appVersion !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  return {
    ok: true,
    desktop: {
      name: displayText(info.name, 64) || "Deck",
      os: displayText(info.os, 32),
      appVersion: displayText(info.appVersion, 32),
    },
  };
}

function parseJsonSafely(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value = parseJsonText(utf8Decode(bytes));
    return isRecord(value) ? { ...value } : null;
  } catch {
    return null;
  }
}

/** What the desktop remembers about a QR it is showing. */
export interface PendingPairing {
  readonly pairingId: string;
  readonly secret: Uint8Array;
  readonly desktopSecretKey: Uint8Array;
  readonly desktopPublicKey: Uint8Array;
  readonly expiresAt: number;
  /** True once a valid `pair-hello` was accepted; a second one is refused whatever it holds. */
  readonly used: boolean;
}

export function rejectFrame(reason: PairRejectReason): Uint8Array {
  return encodeFrame({ type: "pair-reject", reason });
}

export type PairHelloResult =
  | {
      readonly ok: true;
      readonly reply: Uint8Array;
      /** The record to keep instead of the one passed in: marked used. */
      readonly pending: PendingPairing;
      readonly pairKey: Uint8Array;
      readonly phonePublicKey: Uint8Array;
      readonly phone: PhoneInfo;
    }
  | { readonly ok: false; readonly reason: PairRejectReason; readonly reply: Uint8Array };

function refuse(reason: PairRejectReason): PairHelloResult {
  return { ok: false, reason, reply: rejectFrame(reason) };
}

/**
 * Judges one `pair-hello`. Order matters: `used` and `expired` are decided before the proof is
 * looked at, so a replay never learns whether its box was valid, and a bad proof does not burn
 * the QR (anyone who knows the pairing id could otherwise cancel it).
 */
export function acceptPairHello(
  crypto: CryptoProvider,
  pending: PendingPairing | null,
  frameBytes: Uint8Array,
  now: number,
  desktop: DesktopInfo,
): PairHelloResult {
  if (pending === null) return refuse("unknown");
  if (pending.used) return refuse("used");
  if (now >= pending.expiresAt) return refuse("expired");
  const frame = decodeFrame(frameBytes);
  if (frame === null || frame.type !== "pair-hello") return refuse("bad-proof");

  let pairKey: Uint8Array;
  try {
    pairKey = derivePairKey(crypto, {
      ownSecretKey: pending.desktopSecretKey,
      peerPublicKey: frame.phonePublicKey,
      secret: pending.secret,
      pairingId: pending.pairingId,
    });
  } catch {
    return refuse("bad-proof"); // a low-order public key
  }
  const keys = derivePairBoxKeys(crypto, pairKey);
  const plaintext = crypto.open(keys.p2d, ZERO_NONCE, frame.box, utf8Encode(AAD_PAIR_HELLO));
  if (plaintext === null) return refuse("bad-proof");
  const info = parseJsonSafely(plaintext);
  if (
    info === null ||
    typeof info.name !== "string" ||
    typeof info.model !== "string" ||
    typeof info.os !== "string" ||
    !isSafeNonNegative(info.v)
  ) {
    return refuse("bad-proof");
  }

  const reply = encodeFrame({
    type: "pair-accept",
    box: crypto.seal(
      keys.d2p,
      ZERO_NONCE,
      utf8Encode(
        JSON.stringify({ name: desktop.name, os: desktop.os, appVersion: desktop.appVersion }),
      ),
      utf8Encode(AAD_PAIR_ACCEPT),
    ),
  });
  return {
    ok: true,
    reply,
    pending: { ...pending, used: true },
    pairKey,
    phonePublicKey: frame.phonePublicKey,
    phone: {
      name: displayText(info.name, 64) || "iPhone",
      model: displayText(info.model, 64),
      os: displayText(info.os, 32),
      v: info.v,
    },
  };
}
