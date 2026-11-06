import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { CryptoProvider } from "@protocol/crypto";

/**
 * The phone's `CryptoProvider` (design §2): pure-JavaScript @noble primitives, because Expo Go has
 * no native ChaCha20-Poly1305 or X25519. The random source is injected so the app passes
 * `expo-crypto`'s `getRandomBytes` (the OS CSPRNG) and the tests pass Node's.
 */
export function createNobleCrypto(randomBytes: (length: number) => Uint8Array): CryptoProvider {
  const random = (length: number): Uint8Array => {
    const bytes = randomBytes(length);
    if (bytes.length !== length) throw new Error("random source returned the wrong length");
    return bytes;
  };

  const agree = (secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array => {
    const shared = x25519.getSharedSecret(secretKey, peerPublicKey);
    // A low-order peer key yields all zeroes; refuse it rather than derive keys from a constant.
    if (shared.every((byte) => byte === 0)) throw new Error("x25519: low-order public key");
    return shared;
  };

  return {
    randomBytes: random,
    x25519KeyPair() {
      const secretKey = random(32);
      return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
    },
    x25519PublicKey: (secretKey) => x25519.getPublicKey(secretKey),
    x25519: agree,
    hkdfSha256: (ikm, salt, info, length) => hkdf(sha256, ikm, salt, info, length),
    sha256: (data) => sha256(data),
    hmacSha256: (key, data) => hmac(sha256, key, data),
    seal: (key, nonce, plaintext, aad) => chacha20poly1305(key, nonce, aad).encrypt(plaintext),
    open(key, nonce, sealed, aad) {
      try {
        return chacha20poly1305(key, nonce, aad).decrypt(sealed);
      } catch {
        // noble throws on a bad tag; the contract is a null, never an exception.
        return null;
      }
    },
  };
}
