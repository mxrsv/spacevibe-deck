/**
 * Every key derivation of the pairing and the session handshake (design §3, §4). All HKDF-SHA256.
 * The info strings are the protocol: changing one orphans every existing pairing.
 */
import type { CryptoProvider } from "./crypto";
import { b64urlEncode, concatBytes, utf8Encode } from "./encoding";

export const INFO_CLAIM = "deck/v1/claim";
export const INFO_PAIR_PREFIX = "deck/v1/pair|";
export const INFO_PAIR_BOX_P2D = "deck/v1/pair-box/p2d";
export const INFO_PAIR_BOX_D2P = "deck/v1/pair-box/d2p";
export const INFO_PUSH = "deck/v1/push";
export const INFO_SESSION_PREFIX = "deck/v1/session|";

export const AAD_PAIR_HELLO = "deck/v1/pair-hello";
export const AAD_PAIR_ACCEPT = "deck/v1/pair-accept";
export const AAD_PUSH = "deck/v1/push";

const EMPTY = new Uint8Array(0);

/** What the relay stores for the claim: it can check the phone saw the QR without learning `secret`. */
export function deriveClaimToken(crypto: CryptoProvider, secret: Uint8Array): Uint8Array {
  return crypto.hkdfSha256(secret, EMPTY, utf8Encode(INFO_CLAIM), 32);
}

/**
 * The long-lived key of one pairing. `ownSecretKey`/`peerPublicKey` are the phone's static key and
 * the desktop's, or the other way round; X25519 makes both sides agree. `secret` (from the QR)
 * as salt means a relay that swapped the public keys still cannot derive it.
 */
export function derivePairKey(
  crypto: CryptoProvider,
  input: {
    readonly ownSecretKey: Uint8Array;
    readonly peerPublicKey: Uint8Array;
    readonly secret: Uint8Array;
    readonly pairingId: string;
  },
): Uint8Array {
  const shared = crypto.x25519(input.ownSecretKey, input.peerPublicKey);
  return crypto.hkdfSha256(
    shared,
    input.secret,
    utf8Encode(INFO_PAIR_PREFIX + input.pairingId),
    32,
  );
}

/** One key per direction; each seals exactly one message, so a zero nonce is safe. */
export function derivePairBoxKeys(
  crypto: CryptoProvider,
  pairKey: Uint8Array,
): { readonly p2d: Uint8Array; readonly d2p: Uint8Array } {
  return {
    p2d: crypto.hkdfSha256(pairKey, EMPTY, utf8Encode(INFO_PAIR_BOX_P2D), 32),
    d2p: crypto.hkdfSha256(pairKey, EMPTY, utf8Encode(INFO_PAIR_BOX_D2P), 32),
  };
}

export function derivePushKey(crypto: CryptoProvider, pairKey: Uint8Array): Uint8Array {
  return crypto.hkdfSha256(pairKey, EMPTY, utf8Encode(INFO_PUSH), 32);
}

/** `sha256(hello || welcome)` as the exact bytes each side saw, so a swapped field breaks the keys. */
export function sessionTranscript(
  crypto: CryptoProvider,
  helloFrame: Uint8Array,
  welcomeFrame: Uint8Array,
): Uint8Array {
  return crypto.sha256(concatBytes(helloFrame, welcomeFrame));
}

export function deriveSessionKeys(
  crypto: CryptoProvider,
  input: {
    readonly pairKey: Uint8Array;
    readonly ownEphemeralSecret: Uint8Array;
    readonly peerEphemeralPublic: Uint8Array;
    readonly helloFrame: Uint8Array;
    readonly welcomeFrame: Uint8Array;
  },
): { readonly p2d: Uint8Array; readonly d2p: Uint8Array } {
  const shared = crypto.x25519(input.ownEphemeralSecret, input.peerEphemeralPublic);
  const transcript = sessionTranscript(crypto, input.helloFrame, input.welcomeFrame);
  const info = utf8Encode(INFO_SESSION_PREFIX + b64urlEncode(transcript));
  const okm = crypto.hkdfSha256(shared, input.pairKey, info, 64);
  return { p2d: okm.slice(0, 32), d2p: okm.slice(32, 64) };
}
