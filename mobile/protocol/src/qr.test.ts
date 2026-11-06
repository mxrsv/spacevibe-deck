import { describe, expect, it } from "vitest";
import { createNodeCrypto } from "./crypto-node";
import { b64urlEncode, randomId, utf8Encode } from "./encoding";
import { PAIRING_TTL_MS } from "./limits";
import { encodePairingQr, parsePairingQr, QR_PREFIX, type PairingQr } from "./qr";

const crypto = createNodeCrypto();
const NOW = 1_800_000_000_000;

function sample(overrides: Partial<PairingQr> = {}): PairingQr {
  return {
    relayUrl: "https://api.deck.spacevibe.dev/relay",
    pairingId: randomId(crypto),
    desktopPublicKey: crypto.x25519KeyPair().publicKey,
    secret: crypto.randomBytes(32),
    expiresAt: NOW + PAIRING_TTL_MS,
    desktopName: "Studio Mac",
    ...overrides,
  };
}

function forged(body: object): string {
  return QR_PREFIX + b64urlEncode(utf8Encode(JSON.stringify(body)));
}

function validBody() {
  const qr = sample();
  return {
    v: 1,
    r: qr.relayUrl,
    p: qr.pairingId,
    k: b64urlEncode(qr.desktopPublicKey),
    s: b64urlEncode(qr.secret),
    e: qr.expiresAt,
    n: "Mac",
  };
}

describe("pairing QR", () => {
  it("round-trips every field", () => {
    const qr = sample();
    const parsed = parsePairingQr(encodePairingQr(qr), NOW);
    expect(parsed).toEqual({ ok: true, value: qr });
  });

  it("tolerates surrounding whitespace and a trailing slash on the relay", () => {
    const text = encodePairingQr(sample({ relayUrl: "http://192.168.1.5:8787/" }));
    const parsed = parsePairingQr(`  ${text}\n`, NOW);
    expect(parsed.ok && parsed.value.relayUrl).toBe("http://192.168.1.5:8787");
  });

  it("sanitises the desktop name on both encode and parse", () => {
    const long = "x".repeat(200);
    const text = encodePairingQr(sample({ desktopName: "Mac" + String.fromCharCode(7) + long }));
    const parsed = parsePairingQr(text, NOW);
    expect(parsed.ok && parsed.value.desktopName).toBe(("Mac" + long).slice(0, 64));
    const hostile = parsePairingQr(
      forged({ ...validBody(), n: "A" + String.fromCharCode(0x1b) + "B" }),
      NOW,
    );
    expect(hostile.ok && hostile.value.desktopName).toBe("AB");
  });

  it("names a missing desktop name rather than showing nothing", () => {
    const parsed = parsePairingQr(forged({ ...validBody(), n: "" }), NOW);
    expect(parsed.ok && parsed.value.desktopName).toBe("Deck");
  });

  it("says not-deck for text that is not ours", () => {
    for (const text of ["", "https://example.com", "WIFI:S:x;;", "deck-pair"]) {
      expect(parsePairingQr(text, NOW)).toEqual({ ok: false, reason: "not-deck" });
    }
  });

  it("says malformed for damaged payloads", () => {
    const body = validBody();
    const cases = [
      QR_PREFIX + "!!!",
      QR_PREFIX + b64urlEncode(utf8Encode("not json")),
      QR_PREFIX + b64urlEncode(utf8Encode("[1,2]")),
      forged({ ...body, p: "short" }),
      forged({ ...body, k: "AAAA" }),
      forged({ ...body, s: 5 }),
      forged({ ...body, r: "ftp://relay.example" }),
      forged({ ...body, r: "javascript:alert(1)" }),
      forged({ ...body, e: "soon" }),
      forged({ ...body, e: -1 }),
      forged({ ...body, n: 7 }),
      forged({ ...body, v: undefined }),
      forged({ ...body, e: NOW + PAIRING_TTL_MS * 10 }),
    ];
    for (const text of cases) {
      expect(parsePairingQr(text, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("says unsupported-version for another QR version", () => {
    expect(parsePairingQr(forged({ ...validBody(), v: 2 }), NOW)).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
  });

  it("says expired at and after the expiry instant, and works just before", () => {
    const text = encodePairingQr(sample());
    expect(parsePairingQr(text, NOW + PAIRING_TTL_MS - 1).ok).toBe(true);
    expect(parsePairingQr(text, NOW + PAIRING_TTL_MS)).toEqual({ ok: false, reason: "expired" });
    expect(parsePairingQr(text, NOW + PAIRING_TTL_MS + 60_000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
