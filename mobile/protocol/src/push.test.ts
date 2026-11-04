import { describe, expect, it } from "vitest";
import { createNodeCrypto } from "./crypto-node";
import { b64urlDecode, b64urlEncode } from "./encoding";
import { MAX_PUSH_BYTES } from "./limits";
import { openPush, sealPush, type PushPayload } from "./push";

const crypto = createNodeCrypto();
const key = crypto.randomBytes(32);
const payload: PushPayload = {
  title: "Claude needs you",
  body: "Approve the edit?",
  paneId: 3,
  kind: "requested",
  desktop: "Studio Mac",
  at: 1_800_000_000_000,
};

describe("sealed push", () => {
  it("opens to the payload that was sealed", () => {
    expect(openPush(crypto, key, sealPush(crypto, key, payload))).toEqual(payload);
  });

  it("is base64url and never repeats for the same payload", () => {
    const a = sealPush(crypto, key, payload);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealPush(crypto, key, payload)).not.toBe(a);
  });

  it("does not leak the copy: the visible bytes hold no plaintext", () => {
    expect(
      Buffer.from(b64urlDecode(sealPush(crypto, key, payload))).toString("latin1"),
    ).not.toContain("Approve");
  });

  it("uses the supplied nonce, for the test vectors", () => {
    const nonce = new Uint8Array(12).fill(5);
    const data = sealPush(crypto, key, payload, nonce);
    expect(b64urlDecode(data).subarray(0, 12)).toEqual(nonce);
    expect(data).toBe(sealPush(crypto, key, payload, nonce));
  });

  it("returns null under another key, for a flipped bit, for truncation and for junk", () => {
    const data = sealPush(crypto, key, payload);
    expect(openPush(crypto, crypto.randomBytes(32), data)).toBeNull();
    const bytes = b64urlDecode(data);
    bytes[bytes.length - 1] ^= 1;
    expect(openPush(crypto, key, b64urlEncode(bytes))).toBeNull();
    expect(openPush(crypto, key, data.slice(0, 20))).toBeNull();
    expect(openPush(crypto, key, "not base64!")).toBeNull();
    expect(openPush(crypto, key, "")).toBeNull();
    expect(openPush(crypto, key, "A".repeat(MAX_PUSH_BYTES + 1))).toBeNull();
  });

  it("clamps oversized and unsafe text so a push always fits", () => {
    const huge = {
      ...payload,
      title: "t".repeat(5000),
      body: "🚀".repeat(5000),
      desktop: "d".repeat(500),
    };
    const data = sealPush(crypto, key, huge);
    expect(data.length).toBeLessThanOrEqual(MAX_PUSH_BYTES);
    const opened = openPush(crypto, key, data);
    expect(opened?.title).toHaveLength(80);
    expect(Array.from(opened?.body ?? "")).toHaveLength(240);
    expect(opened?.desktop).toHaveLength(64);
  });

  it("strips control characters from copy it opens", () => {
    const dirty = { ...payload, body: "ok" + String.fromCharCode(0x1b) + "[2Jgone" };
    expect(openPush(crypto, key, sealPush(crypto, key, dirty))?.body).toBe("ok[2Jgone");
  });
});
