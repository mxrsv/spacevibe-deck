const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** RFC 4648 §5 without padding. */
export function b64urlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64URL_ALPHABET[(chunk >> 18) & 63] + B64URL_ALPHABET[(chunk >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL_ALPHABET[(chunk >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL_ALPHABET[chunk & 63];
  }
  return out;
}

/** The caller has already matched the alphabet (`isKey32`); this only rebuilds the bytes. */
export function b64urlDecode(text: string): Uint8Array {
  const standard = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * The stored form of a token: `b64url(sha256(rawToken))`. Clients present the token as base64url
 * of its 32 raw bytes, and the pairing registered the hash of those bytes (design §3).
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", b64urlDecode(token));
  return b64urlEncode(new Uint8Array(digest));
}

/** Equal-length comparison that does not stop at the first differing byte. */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}
