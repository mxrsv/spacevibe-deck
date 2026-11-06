import { describe, expect, it } from "vitest";
import { createNodeCrypto } from "./crypto-node";
import { utf8Encode } from "./encoding";
import { hex, loadVectors } from "./fixtures";

const crypto = createNodeCrypto();
const vectors = loadVectors();

describe("X25519", () => {
  const { alice, bob, sharedSecret } = vectors.rfc7748;

  it("derives the RFC 7748 public keys from the secrets", () => {
    expect(crypto.x25519PublicKey(hex(alice.secretKey))).toEqual(hex(alice.publicKey));
    expect(crypto.x25519PublicKey(hex(bob.secretKey))).toEqual(hex(bob.publicKey));
  });

  it("reaches the RFC 7748 shared secret from both sides", () => {
    expect(crypto.x25519(hex(alice.secretKey), hex(bob.publicKey))).toEqual(hex(sharedSecret));
    expect(crypto.x25519(hex(bob.secretKey), hex(alice.publicKey))).toEqual(hex(sharedSecret));
  });

  it("generates key pairs whose halves match and whose secrets agree", () => {
    const a = crypto.x25519KeyPair();
    const b = crypto.x25519KeyPair();
    expect(a.secretKey).toHaveLength(32);
    expect(a.publicKey).toEqual(crypto.x25519PublicKey(a.secretKey));
    expect(crypto.x25519(a.secretKey, b.publicKey)).toEqual(
      crypto.x25519(b.secretKey, a.publicKey),
    );
  });

  it("refuses an all-zero output from a low-order peer key", () => {
    const { secretKey } = crypto.x25519KeyPair();
    expect(() => crypto.x25519(secretKey, new Uint8Array(32))).toThrow(/.+/);
    const one = new Uint8Array(32);
    one[0] = 1;
    expect(() => crypto.x25519(secretKey, one)).toThrow(/.+/);
  });

  it("rejects keys of the wrong length", () => {
    expect(() => crypto.x25519(new Uint8Array(31), new Uint8Array(32))).toThrow(/.+/);
    expect(() => crypto.x25519(crypto.x25519KeyPair().secretKey, new Uint8Array(31))).toThrow(/.+/);
  });
});

describe("hash functions", () => {
  it("reproduces RFC 5869 test case 1", () => {
    const v = vectors.rfc5869;
    const okm = crypto.hkdfSha256(hex(v.ikm), hex(v.salt), hex(v.info), v.length);
    expect(okm).toEqual(hex(v.okm));
  });

  it("hashes with SHA-256 and HMAC-SHA-256 (FIPS 180 and RFC 4231 vectors)", () => {
    expect(Buffer.from(crypto.sha256(utf8Encode("abc"))).toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const mac = crypto.hmacSha256(new Uint8Array(20).fill(0x0b), utf8Encode("Hi There"));
    expect(Buffer.from(mac).toString("hex")).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });
});

describe("ChaCha20-Poly1305", () => {
  const v = vectors.rfc8439;
  const key = hex(v.key);
  const nonce = hex(v.nonce);
  const aad = hex(v.aad);
  const sealed = hex(v.ciphertext + v.tag);

  it("seals the RFC 8439 section 2.8.2 plaintext to the published ciphertext and tag", () => {
    expect(crypto.seal(key, nonce, utf8Encode(v.plaintextUtf8), aad)).toEqual(sealed);
  });

  it("opens it back", () => {
    expect(crypto.open(key, nonce, sealed, aad)).toEqual(utf8Encode(v.plaintextUtf8));
  });

  it("returns null, without throwing, for every kind of tampering", () => {
    const flipped = (at: number) => {
      const copy = sealed.slice();
      copy[at] ^= 1;
      return copy;
    };
    expect(crypto.open(key, nonce, flipped(0), aad)).toBeNull();
    expect(crypto.open(key, nonce, flipped(sealed.length - 1), aad)).toBeNull();
    expect(crypto.open(key, nonce, sealed, hex("00"))).toBeNull();
    expect(crypto.open(key, hex("000000000000000000000000"), sealed, aad)).toBeNull();
    expect(crypto.open(new Uint8Array(32), nonce, sealed, aad)).toBeNull();
    expect(crypto.open(key, nonce, sealed.subarray(0, 8), aad)).toBeNull();
    expect(crypto.open(key, nonce, new Uint8Array(0), aad)).toBeNull();
  });

  it("handles an empty plaintext", () => {
    const box = crypto.seal(key, nonce, new Uint8Array(0), aad);
    expect(box).toHaveLength(16);
    expect(crypto.open(key, nonce, box, aad)).toEqual(new Uint8Array(0));
  });

  it("rejects a key or nonce of the wrong size", () => {
    expect(() => crypto.seal(new Uint8Array(31), nonce, new Uint8Array(1), aad)).toThrow(/.+/);
    expect(() => crypto.seal(key, new Uint8Array(8), new Uint8Array(1), aad)).toThrow(/.+/);
  });
});

describe("randomBytes", () => {
  it("returns the requested length, different each time", () => {
    expect(crypto.randomBytes(16)).toHaveLength(16);
    expect(crypto.randomBytes(16)).not.toEqual(crypto.randomBytes(16));
  });
});
