import { describe, expect, it } from "vitest";
import {
  closeCodeOf,
  errorOfCloseCode,
  pairingRegistrationUrl,
  pairingSocketUrl,
  parseClientToRelay,
  parsePairingRegistration,
  parseRelayToClient,
} from "./relay-messages";

const TOKEN = "A".repeat(43);
const PAIRING = "B".repeat(22);

describe("relay URLs", () => {
  it("derives the socket and registration URLs from the shipped base", () => {
    expect(pairingSocketUrl("https://api.deck.spacevibe.dev/relay", PAIRING)).toBe(
      `wss://api.deck.spacevibe.dev/relay/v1/pairings/${PAIRING}/socket`,
    );
    expect(pairingRegistrationUrl("https://api.deck.spacevibe.dev/relay/")).toBe(
      "https://api.deck.spacevibe.dev/relay/v1/pairings",
    );
  });

  it("keeps plain ws for a wrangler dev relay on a LAN address", () => {
    expect(pairingSocketUrl("http://192.168.1.20:8787", PAIRING)).toBe(
      `ws://192.168.1.20:8787/v1/pairings/${PAIRING}/socket`,
    );
  });

  it("refuses anything that is not http(s)", () => {
    expect(() => pairingSocketUrl("file:///etc/passwd", PAIRING)).toThrow(/.+/);
    expect(() => pairingRegistrationUrl("javascript:alert(1)")).toThrow(/.+/);
  });
});

describe("client → relay messages", () => {
  it("accepts the documented shapes", () => {
    expect(
      parseClientToRelay(JSON.stringify({ t: "auth", role: "phone", token: TOKEN }), 100),
    ).toEqual({ t: "auth", role: "phone", token: TOKEN });
    expect(
      parseClientToRelay(
        JSON.stringify({ t: "push-token", kind: "apns", token: "ab12cd34ef", env: "sandbox" }),
        100,
      ),
    ).toEqual({ t: "push-token", kind: "apns", token: "ab12cd34ef", env: "sandbox" });
    expect(parseClientToRelay('{"t":"revoke"}', 100)).toEqual({ t: "revoke" });
  });

  it("refuses unknown roles, short tokens, oversized pushes and junk", () => {
    expect(
      parseClientToRelay(JSON.stringify({ t: "auth", role: "admin", token: TOKEN }), 100),
    ).toBeNull();
    expect(
      parseClientToRelay(JSON.stringify({ t: "auth", role: "phone", token: "short" }), 100),
    ).toBeNull();
    expect(
      parseClientToRelay(JSON.stringify({ t: "push", data: "a".repeat(101) }), 100),
    ).toBeNull();
    expect(parseClientToRelay(JSON.stringify({ t: "push", data: "not base64!" }), 100)).toBeNull();
    expect(parseClientToRelay("{not json", 100)).toBeNull();
    expect(parseClientToRelay("[1,2]", 100)).toBeNull();
  });
});

describe("relay → client messages", () => {
  it("reads ready, peer and error", () => {
    expect(
      parseRelayToClient(
        JSON.stringify({ t: "ready", role: "desktop", peerOnline: false, peerLastSeen: 5 }),
      ),
    ).toEqual({ t: "ready", role: "desktop", peerOnline: false, peerLastSeen: 5 });
    expect(parseRelayToClient(JSON.stringify({ t: "error", code: "rate-limited" }))).toEqual({
      t: "error",
      code: "rate-limited",
    });
    expect(parseRelayToClient(JSON.stringify({ t: "error", code: "revoked" }))).toBeNull();
  });

  it("maps close codes both ways", () => {
    expect(errorOfCloseCode(closeCodeOf("revoked"))).toBe("revoked");
    expect(errorOfCloseCode(closeCodeOf("too-large"))).toBe("too-large");
    expect(errorOfCloseCode(1000)).toBeNull();
  });
});

describe("pairing registration", () => {
  it("accepts a well-formed body and refuses a malformed one", () => {
    const body = { pairingId: PAIRING, desktopTokenHash: TOKEN, claimHash: TOKEN, expiresAt: 1 };
    expect(parsePairingRegistration(body)).toEqual(body);
    expect(parsePairingRegistration({ ...body, pairingId: "x" })).toBeNull();
    expect(parsePairingRegistration({ ...body, expiresAt: "soon" })).toBeNull();
  });
});
