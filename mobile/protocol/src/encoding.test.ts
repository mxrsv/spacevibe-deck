import { describe, expect, it } from "vitest";
import { createNodeCrypto } from "./crypto-node";
import {
  b64urlDecode,
  b64urlEncode,
  concatBytes,
  equalBytes,
  hexDecode,
  hexEncode,
  randomId,
  readU64be,
  u64be,
  utf8Decode,
  utf8Encode,
} from "./encoding";

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("utf8", () => {
  it("matches the platform encoder for text across every width", () => {
    for (const text of ["", "plain", "héllo", "日本語", "emoji 🚀 mix", "a\u0000b"]) {
      expect(utf8Encode(text)).toEqual(new Uint8Array(new TextEncoder().encode(text)));
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    }
  });

  it("decodes a long string without choking on the spread limit", () => {
    const text = "x🚀".repeat(50_000);
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it("replaces a lone surrogate on encode", () => {
    expect(utf8Decode(utf8Encode("a" + String.fromCharCode(0xd800) + "b"))).toBe("a�b");
  });

  it.each([
    ["an overlong NUL", [0xc0, 0x80]],
    ["a lone continuation byte", [0x80]],
    ["a truncated sequence", [0xe2, 0x82]],
    ["an encoded surrogate", [0xed, 0xa0, 0x80]],
    ["a code point past U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
    ["a bad continuation byte", [0xe2, 0x28, 0xa1]],
    ["an invalid lead byte", [0xff]],
  ])("rejects %s", (_name, input) => {
    expect(() => utf8Decode(bytes(...input))).toThrow(/.+/);
  });
});

describe("base64url", () => {
  it.each([
    ["", ""],
    ["f", "Zg"],
    ["fo", "Zm8"],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg"],
    ["fooba", "Zm9vYmE"],
    ["foobar", "Zm9vYmFy"],
  ])("encodes the RFC 4648 vector %j", (plain, encoded) => {
    expect(b64urlEncode(utf8Encode(plain))).toBe(encoded);
    expect(utf8Decode(b64urlDecode(encoded))).toBe(plain);
  });

  it("uses the URL alphabet and no padding", () => {
    expect(b64urlEncode(bytes(0xfb, 0xff, 0xfe))).toBe("-__-");
    expect(b64urlEncode(bytes(0xfb))).toBe("-w");
  });

  it("round-trips random bytes of every residue", () => {
    const crypto = createNodeCrypto();
    for (let length = 0; length < 70; length++) {
      const input = crypto.randomBytes(length);
      expect(b64urlDecode(b64urlEncode(input))).toEqual(input);
    }
  });

  it.each(["Zg==", "Zm9v+", "a b", "Z", "Zh", "Zm9vY"])("rejects %j", (text) => {
    expect(() => b64urlDecode(text)).toThrow(/.+/);
  });
});

describe("hex", () => {
  it("round-trips and rejects odd or non-hex input", () => {
    expect(hexEncode(bytes(0, 1, 0xab, 0xff))).toBe("0001abff");
    expect(hexDecode("0001ABff")).toEqual(bytes(0, 1, 0xab, 0xff));
    expect(() => hexDecode("abc")).toThrow(/.+/);
    expect(() => hexDecode("zz")).toThrow(/.+/);
  });
});

describe("concatBytes, equalBytes", () => {
  it("joins parts in order", () => {
    expect(concatBytes(bytes(1), bytes(), bytes(2, 3))).toEqual(bytes(1, 2, 3));
    expect(concatBytes()).toEqual(bytes());
  });

  it("compares by value, and unequal lengths are unequal", () => {
    expect(equalBytes(bytes(1, 2), bytes(1, 2))).toBe(true);
    expect(equalBytes(bytes(1, 2), bytes(1, 3))).toBe(false);
    expect(equalBytes(bytes(1, 2), bytes(1, 2, 3))).toBe(false);
  });
});

describe("u64be", () => {
  it("is big endian", () => {
    expect(u64be(1)).toEqual(bytes(0, 0, 0, 0, 0, 0, 0, 1));
    expect(u64be(0x0102030405)).toEqual(bytes(0, 0, 0, 1, 2, 3, 4, 5));
  });

  it("round-trips up to the largest safe integer", () => {
    for (const value of [0, 1, 255, 256, 2 ** 32, 2 ** 40 + 7, Number.MAX_SAFE_INTEGER]) {
      expect(readU64be(u64be(value), 0)).toBe(value);
    }
  });

  it("reads at an offset", () => {
    expect(readU64be(concatBytes(bytes(9, 9), u64be(77)), 2)).toBe(77);
  });

  it("refuses values that do not fit a safe integer", () => {
    expect(() => u64be(2 ** 53)).toThrow(/.+/);
    expect(() => u64be(-1)).toThrow(/.+/);
    expect(() => u64be(1.5)).toThrow(/.+/);
    expect(() => readU64be(bytes(0, 0x20, 0, 0, 0, 0, 0, 0), 0)).toThrow(/.+/);
    expect(() => readU64be(bytes(1, 2, 3), 0)).toThrow(/.+/);
  });
});

describe("randomId", () => {
  it("is 22 base64url characters and differs per call", () => {
    const crypto = createNodeCrypto();
    const a = randomId(crypto);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomId(crypto)).not.toBe(a);
  });
});
