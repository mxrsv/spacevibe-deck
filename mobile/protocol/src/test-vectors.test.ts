import { hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildVectors } from "../scripts/make-test-vectors";
import { createNodeCrypto } from "./crypto-node";
import { b64urlEncode, hexEncode, utf8Encode } from "./encoding";
import { hex, loadVectors } from "./fixtures";
import { decodeFrame } from "./frames";
import {
  deriveClaimToken,
  derivePairBoxKeys,
  derivePairKey,
  derivePushKey,
  deriveSessionKeys,
} from "./keys";
import { openPush } from "./push";

const crypto = createNodeCrypto();
const vectors = loadVectors();
const deck = vectors.deck;

describe("test-vectors.json", () => {
  it("is exactly what the generator produces, so it cannot drift silently", () => {
    expect(vectors).toEqual(buildVectors(crypto));
  });

  it("derives the pair key as HKDF-SHA256 would, checked against node's own HKDF", () => {
    const expected = new Uint8Array(
      hkdfSync(
        "sha256",
        hex(deck.pairing.sharedSecret),
        hex(deck.pairing.secret),
        `deck/v1/pair|${deck.pairing.pairingIdBase64url}`,
        32,
      ),
    );
    expect(hex(deck.pairing.pairKey)).toEqual(expected);
  });

  it("derives every pairing key from the fixed inputs, from either side", () => {
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

  it("derives the same session keys on both sides from the recorded handshake", () => {
    const s = deck.session;
    const base = {
      pairKey: hex(deck.pairing.pairKey),
      helloFrame: hex(s.helloFrame),
      welcomeFrame: hex(s.welcomeFrame),
    };
    const phone = deriveSessionKeys(crypto, {
      ...base,
      ownEphemeralSecret: hex(s.phoneEphemeral.secretKey),
      peerEphemeralPublic: hex(s.desktopEphemeral.publicKey),
    });
    const desktop = deriveSessionKeys(crypto, {
      ...base,
      ownEphemeralSecret: hex(s.desktopEphemeral.secretKey),
      peerEphemeralPublic: hex(s.phoneEphemeral.publicKey),
    });
    expect(hexEncode(phone.p2d)).toBe(s.keyPhoneToDesktop);
    expect(hexEncode(phone.d2p)).toBe(s.keyDesktopToPhone);
    expect(desktop).toEqual(phone);
    expect(decodeFrame(hex(s.helloFrame))?.type).toBe("hello");
    expect(decodeFrame(hex(s.welcomeFrame))?.type).toBe("welcome");
  });

  it("changes the session keys when a handshake byte changes", () => {
    const s = deck.session;
    const welcome = hex(s.welcomeFrame);
    welcome[welcome.length - 3] ^= 1;
    const tampered = deriveSessionKeys(crypto, {
      pairKey: hex(deck.pairing.pairKey),
      ownEphemeralSecret: hex(s.phoneEphemeral.secretKey),
      peerEphemeralPublic: hex(s.desktopEphemeral.publicKey),
      helloFrame: hex(s.helloFrame),
      welcomeFrame: welcome,
    });
    expect(hexEncode(tampered.p2d)).not.toBe(s.keyPhoneToDesktop);
  });

  it("opens the recorded sealed frame with the recorded AAD", () => {
    const f = deck.sealedFrame;
    const frame = decodeFrame(hex(f.frame));
    expect(frame?.type).toBe("sealed");
    if (frame?.type !== "sealed") return;
    expect(frame.counter).toBe(f.counter);
    expect(crypto.open(hex(f.key), hex(f.nonce), frame.ciphertext, hex(f.aad))).toEqual(
      utf8Encode(f.plaintextUtf8),
    );
  });

  it("opens the recorded sealed push", () => {
    expect(openPush(crypto, hex(deck.push.pushKey), deck.push.data)).toEqual(deck.push.payload);
  });
});
