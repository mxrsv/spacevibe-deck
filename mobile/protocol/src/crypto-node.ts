/**
 * The desktop's (and the tests') `CryptoProvider`, built only on `node:crypto`. Never imported by
 * `index.ts`: the phone cannot load `node:crypto`.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes as nodeRandomBytes,
} from "node:crypto";
import type { CryptoProvider } from "./crypto";
import { b64urlDecode, b64urlEncode } from "./encoding";

const TAG_BYTES = 16;

// PKCS#8 prefix of an X25519 private key: SEQUENCE { 0, SEQUENCE { OID 1.3.101.110 }, OCTET STRING
// { OCTET STRING key } }. Node's JWK import demands the public half too; DER does not, and OpenSSL
// does the RFC 7748 clamping, so any 32 random bytes are a valid secret.
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

function privateKeyOf(secretKey: Uint8Array) {
  if (secretKey.length !== 32) throw new RangeError("An X25519 secret key is 32 bytes");
  const der = new Uint8Array(PKCS8_PREFIX.length + 32);
  der.set(PKCS8_PREFIX);
  der.set(secretKey, PKCS8_PREFIX.length);
  return createPrivateKey({ key: Buffer.from(der), format: "der", type: "pkcs8" });
}

function publicBytesOf(secretKey: Uint8Array): Uint8Array {
  const jwk = createPublicKey(privateKeyOf(secretKey)).export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("X25519 public key export failed");
  return b64urlDecode(jwk.x);
}

function publicKeyOf(publicKey: Uint8Array) {
  if (publicKey.length !== 32) throw new RangeError("An X25519 public key is 32 bytes");
  return createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: b64urlEncode(publicKey) },
    format: "jwk",
  });
}

function checked(length: number, what: string, value: Uint8Array): void {
  if (value.length !== length) throw new RangeError(`${what} must be ${length} bytes`);
}

export function createNodeCrypto(): CryptoProvider {
  return {
    randomBytes(length) {
      return new Uint8Array(nodeRandomBytes(length));
    },

    x25519KeyPair() {
      const { privateKey, publicKey } = generateKeyPairSync("x25519");
      const secret = privateKey.export({ format: "jwk" });
      const pub = publicKey.export({ format: "jwk" });
      if (typeof secret.d !== "string" || typeof pub.x !== "string") {
        throw new Error("X25519 key generation failed");
      }
      return { secretKey: b64urlDecode(secret.d), publicKey: b64urlDecode(pub.x) };
    },

    x25519PublicKey(secretKey) {
      return publicBytesOf(secretKey);
    },

    x25519(secretKey, peerPublicKey) {
      let shared: Uint8Array;
      try {
        shared = new Uint8Array(
          diffieHellman({
            privateKey: privateKeyOf(secretKey),
            publicKey: publicKeyOf(peerPublicKey),
          }),
        );
      } catch {
        throw new Error("X25519 failed");
      }
      // A low-order peer key forces the output to zero whatever our secret is (RFC 7748 §6.1).
      let nonZero = 0;
      for (const byte of shared) nonZero |= byte;
      if (nonZero === 0) throw new Error("X25519 produced an all-zero shared secret");
      return shared;
    },

    hkdfSha256(ikm, salt, info, length) {
      return new Uint8Array(hkdfSync("sha256", ikm, salt, info, length));
    },

    sha256(data) {
      return new Uint8Array(createHash("sha256").update(data).digest());
    },

    hmacSha256(key, data) {
      return new Uint8Array(createHmac("sha256", key).update(data).digest());
    },

    seal(key, nonce, plaintext, aad) {
      checked(32, "key", key);
      checked(12, "nonce", nonce);
      const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad, { plaintextLength: plaintext.length });
      const body = cipher.update(plaintext);
      cipher.final();
      const out = new Uint8Array(body.length + TAG_BYTES);
      out.set(body);
      out.set(cipher.getAuthTag(), body.length);
      return out;
    },

    open(key, nonce, sealed, aad) {
      checked(32, "key", key);
      checked(12, "nonce", nonce);
      if (sealed.length < TAG_BYTES) return null;
      const bodyLength = sealed.length - TAG_BYTES;
      try {
        const decipher = createDecipheriv("chacha20-poly1305", key, nonce, {
          authTagLength: TAG_BYTES,
        });
        decipher.setAuthTag(sealed.subarray(bodyLength));
        decipher.setAAD(aad, { plaintextLength: bodyLength });
        const body = decipher.update(sealed.subarray(0, bodyLength));
        decipher.final();
        return new Uint8Array(body);
      } catch {
        return null;
      }
    },
  };
}
