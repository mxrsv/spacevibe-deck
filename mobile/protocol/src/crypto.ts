/**
 * The primitives the protocol needs, behind one interface so the desktop (`node:crypto`) and the
 * phone (noble + expo-crypto) run the same protocol code. Both are tested against the vectors in
 * `test-vectors.json`.
 */
export interface CryptoProvider {
  randomBytes(length: number): Uint8Array;
  x25519KeyPair(): { readonly secretKey: Uint8Array; readonly publicKey: Uint8Array }; // 32 + 32
  x25519PublicKey(secretKey: Uint8Array): Uint8Array;
  x25519(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array; // throws on all-zero output
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array;
  sha256(data: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  /** ChaCha20-Poly1305 (RFC 8439), 32-byte key, 12-byte nonce, 16-byte tag appended. */
  seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array;
  /** Null when authentication fails; never throws on a bad tag. */
  open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array | null;
}
