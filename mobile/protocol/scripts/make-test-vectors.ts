/**
 * Regenerates `src/test-vectors.json`: `npx tsx protocol/scripts/make-test-vectors.ts` from mobile/.
 * Every input is fixed, so the output is byte-identical on every run; the phone's noble
 * implementation is tested against the same file. A change to this file's output is a protocol
 * break and needs a deliberate review.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CryptoProvider } from "../src/crypto";
import { createNodeCrypto } from "../src/crypto-node";
import { b64urlEncode, hexEncode, utf8Encode } from "../src/encoding";
import { encodeFrame } from "../src/frames";
import {
  AAD_PAIR_ACCEPT,
  AAD_PAIR_HELLO,
  AAD_PUSH,
  deriveClaimToken,
  derivePairBoxKeys,
  derivePairKey,
  derivePushKey,
  deriveSessionKeys,
  INFO_CLAIM,
  INFO_PAIR_BOX_D2P,
  INFO_PAIR_BOX_P2D,
  INFO_PAIR_PREFIX,
  INFO_PUSH,
  INFO_SESSION_PREFIX,
  sessionTranscript,
} from "../src/keys";
import { sealPush } from "../src/push";

function sequence(start: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}

function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

const hex = hexEncode;

function labelled(crypto: CryptoProvider, label: string) {
  const secretKey = crypto.sha256(utf8Encode(`deck-test-vector/${label}`));
  return { secretKey: hex(secretKey), publicKey: hex(crypto.x25519PublicKey(secretKey)) };
}

export function buildVectors(crypto: CryptoProvider = createNodeCrypto()) {
  const rfc7748 = {
    source: "RFC 7748 section 6.1",
    alice: {
      secretKey: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
      publicKey: "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
    },
    bob: {
      secretKey: "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
      publicKey: "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
    },
    sharedSecret: "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
  };

  const rfc8439 = {
    source: "RFC 8439 section 2.8.2",
    key: hex(sequence(0x80, 32)),
    nonce: "070000004041424344454647",
    aad: "50515253c0c1c2c3c4c5c6c7",
    plaintextUtf8:
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    ciphertext:
      "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116",
    tag: "1ae10b594f09e26a7e902ecbd0600691",
  };

  const rfc5869 = {
    source: "RFC 5869 appendix A.1 (test case 1)",
    ikm: "0b".repeat(22),
    salt: hex(sequence(0, 13)),
    info: hex(sequence(0xf0, 10)),
    length: 42,
    okm: "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
  };

  // --- Deck pairing -------------------------------------------------------------------------
  const pairingId = b64urlEncode(sequence(0x00, 16));
  const secret = sequence(0x20, 32);
  const desktop = labelled(crypto, "desktop-static");
  const phone = labelled(crypto, "phone-static");
  const shared = crypto.x25519(fromHex(phone.secretKey), fromHex(desktop.publicKey));
  const pairKey = derivePairKey(crypto, {
    ownSecretKey: fromHex(phone.secretKey),
    peerPublicKey: fromHex(desktop.publicKey),
    secret,
    pairingId,
  });
  const box = derivePairBoxKeys(crypto, pairKey);
  const pushKey = derivePushKey(crypto, pairKey);
  const claimToken = deriveClaimToken(crypto, secret);
  const zeroNonce = new Uint8Array(12);

  const pairHelloPlain = JSON.stringify({
    name: "Test Phone",
    model: "iPhone17,1",
    os: "iOS 26.0",
    v: 1,
  });
  const pairAcceptPlain = JSON.stringify({
    name: "Test Desktop",
    os: "macos",
    appVersion: "1.2.3",
  });

  // --- Session ------------------------------------------------------------------------------
  const phoneEph = labelled(crypto, "phone-ephemeral");
  const desktopEph = labelled(crypto, "desktop-ephemeral");
  const helloFrame = encodeFrame({
    type: "hello",
    body: {
      v: 1,
      min: 1,
      pairingId,
      eph: fromHex(phoneEph.publicKey),
      nonce: sequence(0x40, 16),
    },
  });
  const welcomeFrame = encodeFrame({
    type: "welcome",
    body: {
      v: 1,
      min: 1,
      eph: fromHex(desktopEph.publicKey),
      nonce: sequence(0x60, 16),
      verdict: "ok",
    },
  });
  const transcript = sessionTranscript(crypto, helloFrame, welcomeFrame);
  const session = deriveSessionKeys(crypto, {
    pairKey,
    ownEphemeralSecret: fromHex(phoneEph.secretKey),
    peerEphemeralPublic: fromHex(desktopEph.publicKey),
    helloFrame,
    welcomeFrame,
  });
  const sessionShared = crypto.x25519(fromHex(phoneEph.secretKey), fromHex(desktopEph.publicKey));

  const sealedPlain = JSON.stringify({
    ev: "session.start",
    p: { device: "Test Phone", appVersion: "0.1.0" },
  });
  const sealedCounter = 0;
  const sealedNonce = new Uint8Array(12);
  const sealedAad = Uint8Array.of(0x03, 0, 0, 0, 0, 0, 0, 0, sealedCounter);
  const sealedFrame = encodeFrame({
    type: "sealed",
    counter: sealedCounter,
    ciphertext: crypto.seal(session.p2d, sealedNonce, utf8Encode(sealedPlain), sealedAad),
  });

  // --- Push ---------------------------------------------------------------------------------
  const pushNonce = sequence(0x70, 12);
  const pushPayload = {
    title: "Claude needs you",
    body: "Approve the edit to src/app.ts?",
    paneId: 7,
    kind: "requested" as const,
    desktop: "Test Desktop",
    at: 1_800_000_000_000,
  };

  return {
    format: 1,
    note: "All byte strings are lowercase hex unless a field says base64url or utf8. Generated by protocol/scripts/make-test-vectors.ts.",
    rfc7748,
    rfc8439,
    rfc5869,
    deck: {
      info: {
        claim: INFO_CLAIM,
        pairPrefix: INFO_PAIR_PREFIX,
        pairBoxP2d: INFO_PAIR_BOX_P2D,
        pairBoxD2p: INFO_PAIR_BOX_D2P,
        push: INFO_PUSH,
        sessionPrefix: INFO_SESSION_PREFIX,
        aadPairHello: AAD_PAIR_HELLO,
        aadPairAccept: AAD_PAIR_ACCEPT,
        aadPush: AAD_PUSH,
      },
      pairing: {
        pairingIdBase64url: pairingId,
        secret: hex(secret),
        desktop,
        phone,
        sharedSecret: hex(shared),
        pairKey: hex(pairKey),
        pairBoxP2d: hex(box.p2d),
        pairBoxD2p: hex(box.d2p),
        pushKey: hex(pushKey),
        claimToken: hex(claimToken),
        claimTokenBase64url: b64urlEncode(claimToken),
        claimHashBase64url: b64urlEncode(crypto.sha256(claimToken)),
        pairHello: {
          nonce: hex(zeroNonce),
          plaintextUtf8: pairHelloPlain,
          sealed: hex(
            crypto.seal(box.p2d, zeroNonce, utf8Encode(pairHelloPlain), utf8Encode(AAD_PAIR_HELLO)),
          ),
        },
        pairAccept: {
          nonce: hex(zeroNonce),
          plaintextUtf8: pairAcceptPlain,
          sealed: hex(
            crypto.seal(
              box.d2p,
              zeroNonce,
              utf8Encode(pairAcceptPlain),
              utf8Encode(AAD_PAIR_ACCEPT),
            ),
          ),
        },
      },
      session: {
        phoneEphemeral: phoneEph,
        desktopEphemeral: desktopEph,
        helloFrame: hex(helloFrame),
        welcomeFrame: hex(welcomeFrame),
        sharedSecret: hex(sessionShared),
        transcript: hex(transcript),
        infoUtf8: INFO_SESSION_PREFIX + b64urlEncode(transcript),
        keyPhoneToDesktop: hex(session.p2d),
        keyDesktopToPhone: hex(session.d2p),
      },
      sealedFrame: {
        key: hex(session.p2d),
        counter: sealedCounter,
        nonce: hex(sealedNonce),
        aad: hex(sealedAad),
        plaintextUtf8: sealedPlain,
        frame: hex(sealedFrame),
      },
      push: {
        pushKey: hex(pushKey),
        nonce: hex(pushNonce),
        payload: pushPayload,
        data: sealPush(crypto, pushKey, pushPayload, pushNonce),
      },
    },
  };
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === pathToFileURL(self).href
) {
  const target = path.join(path.dirname(self), "..", "src", "test-vectors.json");
  writeFileSync(target, JSON.stringify(buildVectors(), null, 2) + "\n");
  console.log(`wrote ${target}`);
}
