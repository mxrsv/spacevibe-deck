/**
 * Byte helpers the protocol shares with the phone. Written without `TextEncoder`, `Buffer` or
 * `atob`: Hermes ships some of them only partially, and the desktop bundle must compile with the
 * same source (design §0).
 */
import type { CryptoProvider } from "./crypto";

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_LOOKUP: Readonly<Record<string, number>> = Object.fromEntries(
  [...B64URL_ALPHABET].map((char, index) => [char, index]),
);

/**
 * UTF-8 bytes of a string. A lone surrogate becomes U+FFFD, as `TextEncoder` does, because JSON
 * text from `JSON.stringify` never contains one and anything else is already corrupt.
 */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Strict UTF-8 decode: overlong forms, surrogates, out-of-range code points and truncation throw. */
export function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    parts.push(String.fromCodePoint(...chunk));
    chunk = [];
  };
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i];
    let need = 0;
    let min = 0;
    let code = 0;
    if (lead < 0x80) {
      code = lead;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      need = 1;
      min = 0x80;
      code = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      need = 2;
      min = 0x800;
      code = lead & 0x0f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      need = 3;
      min = 0x10000;
      code = lead & 0x07;
    } else {
      throw new Error("Invalid UTF-8");
    }
    if (need > 0 && i + need >= bytes.length) throw new Error("Invalid UTF-8");
    for (let k = 1; k <= need; k++) {
      const next = bytes[i + k];
      if ((next & 0xc0) !== 0x80) throw new Error("Invalid UTF-8");
      code = (code << 6) | (next & 0x3f);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new Error("Invalid UTF-8");
    }
    chunk.push(code);
    if (chunk.length >= 4096) flush();
    i += need + 1;
  }
  flush();
  return parts.join("");
}

/** RFC 4648 §5 without padding. */
export function b64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64URL_ALPHABET[(n >> 18) & 63] +
      B64URL_ALPHABET[(n >> 12) & 63] +
      B64URL_ALPHABET[(n >> 6) & 63] +
      B64URL_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64URL_ALPHABET[(n >> 18) & 63] + B64URL_ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64URL_ALPHABET[(n >> 18) & 63] +
      B64URL_ALPHABET[(n >> 12) & 63] +
      B64URL_ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** Throws on a character outside the alphabet, on padding, and on a length no encoder produces. */
export function b64urlDecode(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error("Invalid base64url length");
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const value = B64URL_LOOKUP[text[i]];
    if (value === undefined) throw new Error("Invalid base64url character");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  // Non-zero leftover bits mean a non-canonical encoding; two spellings of one value would let
  // a relay malleate an otherwise authenticated string.
  if (buffer !== 0) throw new Error("Non-canonical base64url");
  return out;
}

export function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += (byte < 16 ? "0" : "") + byte.toString(16);
  return out;
}

export function hexDecode(text: string): Uint8Array {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) throw new Error("Invalid hex");
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 8-byte big-endian; only safe integers, so a counter never silently loses its top bits. */
export function u64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("u64be needs a safe integer");
  const out = new Uint8Array(8);
  let rest = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

/** Reads 8 big-endian bytes; throws when the value does not fit a safe integer. */
export function readU64be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError("readU64be out of range");
  let value = 0;
  for (let i = 0; i < 8; i++) value = value * 256 + bytes[offset + i];
  if (!Number.isSafeInteger(value)) throw new RangeError("u64 does not fit a safe integer");
  return value;
}

/** Constant time over equal lengths; different lengths are unequal immediately (lengths are public). */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 16 random bytes in base64url: a pairing id, a chunk id, a request correlation id. */
export function randomId(crypto: CryptoProvider): string {
  return b64urlEncode(crypto.randomBytes(16));
}
