import { randomBytes as nodeRandom } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createNodeCrypto } from "@protocol/crypto-node";
import { hexDecode, hexEncode, utf8Encode } from "@protocol/encoding";
import { createNobleCrypto } from "./noble";

const crypto = createNobleCrypto((length) => new Uint8Array(nodeRandom(length)));
const hex = hexDecode;

describe("noble CryptoProvider: published vectors", () => {
  it("X25519 matches RFC 7748 §6.1", () => {
    const aliceSecret = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
    const bobSecret = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
    const alicePublic = crypto.x25519PublicKey(aliceSecret);
    const bobPublic = crypto.x25519PublicKey(bobSecret);
    expect(hexEncode(alicePublic)).toBe(
      "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
    );
    expect(hexEncode(bobPublic)).toBe(
      "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
    );
    const shared = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742";
    expect(hexEncode(crypto.x25519(aliceSecret, bobPublic))).toBe(shared);
    expect(hexEncode(crypto.x25519(bobSecret, alicePublic))).toBe(shared);
  });

  it("refuses an all-zero (low-order) peer key", () => {
    expect(() => crypto.x25519(hex("77".repeat(32)), new Uint8Array(32))).toThrow(
      /low-order|invalid private or public key/,
    );
  });

  it("HKDF-SHA256 matches RFC 5869 test case 1", () => {
    const okm = crypto.hkdfSha256(
      hex("0b".repeat(22)),
      hex("000102030405060708090a0b0c"),
      hex("f0f1f2f3f4f5f6f7f8f9"),
      42,
    );
    expect(hexEncode(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });

  it("SHA-256 and HMAC-SHA-256 match known answers", () => {
    expect(hexEncode(crypto.sha256(utf8Encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // RFC 4231 test case 2.
    expect(
      hexEncode(crypto.hmacSha256(utf8Encode("Jefe"), utf8Encode("what do ya want for nothing?"))),
    ).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("ChaCha20-Poly1305 matches RFC 8439 §2.8.2", () => {
    const key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
    const nonce = hex("070000004041424344454647");
    const aad = hex("50515253c0c1c2c3c4c5c6c7");
    const plaintext = utf8Encode(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    );
    const sealed = crypto.seal(key, nonce, plaintext, aad);
    expect(hexEncode(sealed)).toBe(
      "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b61161ae10b594f09e26a7e902ecbd0600691",
    );
    expect(crypto.open(key, nonce, sealed, aad)).toEqual(plaintext);
  });

  it("open returns null, not an exception, for a bad tag, key, nonce or aad", () => {
    const key = crypto.randomBytes(32);
    const nonce = crypto.randomBytes(12);
    const sealed = crypto.seal(key, nonce, utf8Encode("hi"), utf8Encode("aad"));
    const flipped = sealed.slice();
    flipped[0] ^= 1;
    expect(crypto.open(key, nonce, flipped, utf8Encode("aad"))).toBeNull();
    expect(crypto.open(key, nonce, sealed, utf8Encode("other"))).toBeNull();
    expect(crypto.open(crypto.randomBytes(32), nonce, sealed, utf8Encode("aad"))).toBeNull();
    expect(crypto.open(key, nonce, new Uint8Array(3), utf8Encode("aad"))).toBeNull();
  });
});

describe("noble CryptoProvider against the desktop's node:crypto provider", () => {
  const node = createNodeCrypto();

  it("derives the same shared secret and seals bytes the desktop opens, and back", () => {
    const phone = crypto.x25519KeyPair();
    const desktop = node.x25519KeyPair();
    const fromPhone = crypto.x25519(phone.secretKey, desktop.publicKey);
    expect(fromPhone).toEqual(node.x25519(desktop.secretKey, phone.publicKey));
    const key = node.hkdfSha256(fromPhone, utf8Encode("salt"), utf8Encode("info"), 64);
    expect(crypto.hkdfSha256(fromPhone, utf8Encode("salt"), utf8Encode("info"), 64)).toEqual(key);
    const nonce = crypto.randomBytes(12);
    const aad = utf8Encode("deck/v1/test");
    const body = utf8Encode("needs you: approve the plan? ✓");
    expect(
      node.open(key.slice(0, 32), nonce, crypto.seal(key.slice(0, 32), nonce, body, aad), aad),
    ).toEqual(body);
    expect(
      crypto.open(key.slice(0, 32), nonce, node.seal(key.slice(0, 32), nonce, body, aad), aad),
    ).toEqual(body);
    expect(crypto.hmacSha256(key, body)).toEqual(node.hmacSha256(key, body));
    expect(crypto.sha256(body)).toEqual(node.sha256(body));
  });

  it("rejects a random source that returns the wrong length", () => {
    const broken = createNobleCrypto(() => new Uint8Array(3));
    expect(() => broken.randomBytes(16)).toThrow(/wrong length/);
  });
});
