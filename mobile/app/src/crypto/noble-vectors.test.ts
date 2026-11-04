import { randomBytes as nodeRandom } from "node:crypto";
import { describe, expect, it } from "vitest";
import { b64urlEncode, hexEncode, utf8Encode } from "@protocol/encoding";
import { hex, loadVectors } from "@protocol/fixtures";
import { decodeFrame } from "@protocol/frames";
import {
  deriveClaimToken,
  derivePairBoxKeys,
  derivePairKey,
  derivePushKey,
  deriveSessionKeys,
} from "@protocol/keys";
import { openPush } from "@protocol/push";
import { createNobleCrypto } from "./noble";

// The desktop checks these same vectors with node:crypto (`test-vectors.test.ts`); passing them
// here proves the phone's primitives interoperate byte for byte.
const crypto = createNobleCrypto((length) => new Uint8Array(nodeRandom(length)));
const { rfc7748, rfc8439, rfc5869, deck } = loadVectors();

describe("shared test-vectors.json with the noble provider", () => {
  it("RFC 7748 X25519", () => {
    const alice = hex(rfc7748.alice.secretKey);
    const bob = hex(rfc7748.bob.secretKey);
    expect(hexEncode(crypto.x25519PublicKey(alice))).toBe(rfc7748.alice.publicKey);
    expect(hexEncode(crypto.x25519PublicKey(bob))).toBe(rfc7748.bob.publicKey);
    expect(hexEncode(crypto.x25519(alice, hex(rfc7748.bob.publicKey)))).toBe(rfc7748.sharedSecret);
    expect(hexEncode(crypto.x25519(bob, hex(rfc7748.alice.publicKey)))).toBe(rfc7748.sharedSecret);
  });

  it("RFC 8439 ChaCha20-Poly1305", () => {
    const sealed = crypto.seal(
      hex(rfc8439.key),
      hex(rfc8439.nonce),
      utf8Encode(rfc8439.plaintextUtf8),
      hex(rfc8439.aad),
    );
    expect(hexEncode(sealed)).toBe(rfc8439.ciphertext + rfc8439.tag);
  });

  it("RFC 5869 HKDF-SHA256", () => {
    const okm = crypto.hkdfSha256(
      hex(rfc5869.ikm),
      hex(rfc5869.salt),
      hex(rfc5869.info),
      rfc5869.length,
    );
    expect(hexEncode(okm)).toBe(rfc5869.okm);
  });

  it("derives every pairing key from either side", () => {
    const p = deck.pairing;
    const fromPhone = derivePairKey(crypto, {
      ownSecretKey: hex(p.phone.secretKey),
      peerPublicKey: hex(p.desktop.publicKey),
      secret: hex(p.secret),
      pairingId: p.pairingIdBase64url,
    });
    const fromDesktop = derivePairKey(crypto, {
      ownSecretKey: hex(p.desktop.secretKey),
      peerPublicKey: hex(p.phone.publicKey),
      secret: hex(p.secret),
      pairingId: p.pairingIdBase64url,
    });
    expect(hexEncode(fromPhone)).toBe(p.pairKey);
    expect(hexEncode(fromDesktop)).toBe(p.pairKey);
    const box = derivePairBoxKeys(crypto, fromPhone);
    expect(hexEncode(box.p2d)).toBe(p.pairBoxP2d);
    expect(hexEncode(box.d2p)).toBe(p.pairBoxD2p);
    expect(hexEncode(derivePushKey(crypto, fromPhone))).toBe(p.pushKey);
    const claim = deriveClaimToken(crypto, hex(p.secret));
    expect(hexEncode(claim)).toBe(p.claimToken);
    expect(b64urlEncode(claim)).toBe(p.claimTokenBase64url);
    expect(b64urlEncode(crypto.sha256(claim))).toBe(p.claimHashBase64url);
  });

  it("opens the recorded pair boxes", () => {
    const p = deck.pairing;
    expect(
      crypto.open(
        hex(p.pairBoxP2d),
        hex(p.pairHello.nonce),
        hex(p.pairHello.sealed),
        utf8Encode(deck.info.aadPairHello),
      ),
    ).toEqual(utf8Encode(p.pairHello.plaintextUtf8));
    expect(
      crypto.open(
        hex(p.pairBoxD2p),
        hex(p.pairAccept.nonce),
        hex(p.pairAccept.sealed),
        utf8Encode(deck.info.aadPairAccept),
      ),
    ).toEqual(utf8Encode(p.pairAccept.plaintextUtf8));
  });

  it("derives the recorded session keys on the phone side", () => {
    const s = deck.session;
    const keys = deriveSessionKeys(crypto, {
      pairKey: hex(deck.pairing.pairKey),
      helloFrame: hex(s.helloFrame),
      welcomeFrame: hex(s.welcomeFrame),
      ownEphemeralSecret: hex(s.phoneEphemeral.secretKey),
      peerEphemeralPublic: hex(s.desktopEphemeral.publicKey),
    });
    expect(hexEncode(keys.p2d)).toBe(s.keyPhoneToDesktop);
    expect(hexEncode(keys.d2p)).toBe(s.keyDesktopToPhone);
  });

  it("opens the recorded sealed frame and the recorded sealed push", () => {
    const f = deck.sealedFrame;
    const frame = decodeFrame(hex(f.frame));
    expect(frame?.type).toBe("sealed");
    if (frame?.type !== "sealed") return;
    expect(crypto.open(hex(f.key), hex(f.nonce), frame.ciphertext, hex(f.aad))).toEqual(
      utf8Encode(f.plaintextUtf8),
    );
    expect(openPush(crypto, hex(deck.push.pushKey), deck.push.data)).toEqual(deck.push.payload);
  });
});
