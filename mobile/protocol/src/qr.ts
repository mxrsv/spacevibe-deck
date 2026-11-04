/**
 * The pairing QR (design §3.3): `deck-pair:` + base64url of a small JSON object. It carries the
 * one-time `secret`, so it is shown only while a pairing is pending and never logged.
 */
import { displayText } from "./display-text";
import { b64urlDecode, b64urlEncode, utf8Decode, utf8Encode } from "./encoding";
import { PAIRING_TTL_MS } from "./limits";
import { isPairingId, parseRelayUrl } from "./relay-messages";
import { isRecord, isSafeNonNegative } from "./validate";

export const QR_PREFIX = "deck-pair:";
export const QR_VERSION = 1;
export const DESKTOP_NAME_MAX = 64;

export interface PairingQr {
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly desktopPublicKey: Uint8Array;
  readonly secret: Uint8Array;
  readonly expiresAt: number;
  readonly desktopName: string;
}

export type QrFailure = "not-deck" | "malformed" | "unsupported-version" | "expired";

export type QrResult =
  | { readonly ok: true; readonly value: PairingQr }
  | { readonly ok: false; readonly reason: QrFailure };

/** A desktop name for display: no control characters, at most 64 characters, never empty. */
export function sanitizeDesktopName(name: string): string {
  return displayText(name, DESKTOP_NAME_MAX) || "Deck";
}

export function encodePairingQr(qr: PairingQr): string {
  const json = JSON.stringify({
    v: QR_VERSION,
    r: qr.relayUrl,
    p: qr.pairingId,
    k: b64urlEncode(qr.desktopPublicKey),
    s: b64urlEncode(qr.secret),
    e: qr.expiresAt,
    n: sanitizeDesktopName(qr.desktopName),
  });
  return QR_PREFIX + b64urlEncode(utf8Encode(json));
}

function fixedKey(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length !== 43) return null;
  try {
    return b64urlDecode(value);
  } catch {
    return null;
  }
}

export function parsePairingQr(text: string, now: number): QrResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith(QR_PREFIX)) return { ok: false, reason: "not-deck" };
  let body: unknown;
  try {
    body = JSON.parse(utf8Decode(b64urlDecode(trimmed.slice(QR_PREFIX.length))));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isRecord(body)) return { ok: false, reason: "malformed" };
  if (typeof body.v !== "number") return { ok: false, reason: "malformed" };
  if (body.v !== QR_VERSION) return { ok: false, reason: "unsupported-version" };

  const desktopPublicKey = fixedKey(body.k);
  const secret = fixedKey(body.s);
  if (
    typeof body.r !== "string" ||
    parseRelayUrl(body.r) === null ||
    !isPairingId(body.p) ||
    desktopPublicKey === null ||
    secret === null ||
    !isSafeNonNegative(body.e) ||
    typeof body.n !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }
  // A lifetime longer than the relay accepts cannot be honest, and would keep a leaked QR alive.
  if (body.e > now + PAIRING_TTL_MS * 2) return { ok: false, reason: "malformed" };
  if (now >= body.e) return { ok: false, reason: "expired" };

  return {
    ok: true,
    value: {
      relayUrl: body.r.trim().replace(/\/+$/, ""),
      pairingId: body.p,
      desktopPublicKey,
      secret,
      expiresAt: body.e,
      desktopName: sanitizeDesktopName(body.n),
    },
  };
}
