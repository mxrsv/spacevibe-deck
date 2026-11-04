/**
 * The sealed push payload (design §8). The relay forwards it to APNs inside a generic
 * notification; only the phone, holding `pushKey`, can turn it into the real copy. The phone's
 * Notification Service Extension performs the same open in Swift.
 */
import type { CryptoProvider } from "./crypto";
import { displayText } from "./display-text";
import { b64urlDecode, b64urlEncode, concatBytes, utf8Decode, utf8Encode } from "./encoding";
import { AAD_PUSH } from "./keys";
import { MAX_PUSH_BYTES } from "./limits";
import { isRecord, isSafeNonNegative, oneOf, parseJsonText } from "./validate";

export const PUSH_EVENT_KINDS = ["requested", "completed"] as const;
export type PushEventKind = (typeof PUSH_EVENT_KINDS)[number];

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly paneId: number;
  readonly kind: PushEventKind;
  /** The desktop's name, so a phone with two desktops can say which one needs it. */
  readonly desktop: string;
  /** Ms epoch of the event. */
  readonly at: number;
}

const NONCE_BYTES = 12;
const TITLE_MAX = 80;
const BODY_MAX = 240;
const DESKTOP_MAX = 64;

function clean(payload: PushPayload): PushPayload {
  return {
    title: displayText(payload.title, TITLE_MAX),
    body: displayText(payload.body, BODY_MAX),
    paneId: payload.paneId,
    kind: payload.kind,
    desktop: displayText(payload.desktop, DESKTOP_MAX),
    at: payload.at,
  };
}

/** `b64url(nonce || seal(...))`. Throws if the result would exceed `MAX_PUSH_BYTES`. */
export function sealPush(
  crypto: CryptoProvider,
  pushKey: Uint8Array,
  payload: PushPayload,
  nonce: Uint8Array = crypto.randomBytes(NONCE_BYTES),
): string {
  const plaintext = utf8Encode(JSON.stringify(clean(payload)));
  const data = b64urlEncode(
    concatBytes(nonce, crypto.seal(pushKey, nonce, plaintext, utf8Encode(AAD_PUSH))),
  );
  if (data.length > MAX_PUSH_BYTES) throw new RangeError("The push payload is too large");
  return data;
}

/** The payload, or null when the data is malformed, forged, or sealed under another key. */
export function openPush(
  crypto: CryptoProvider,
  pushKey: Uint8Array,
  data: string,
): PushPayload | null {
  if (data.length > MAX_PUSH_BYTES) return null;
  let bytes: Uint8Array;
  try {
    bytes = b64urlDecode(data);
  } catch {
    return null;
  }
  if (bytes.length < NONCE_BYTES + 16) return null;
  const plaintext = crypto.open(
    pushKey,
    bytes.subarray(0, NONCE_BYTES),
    bytes.subarray(NONCE_BYTES),
    utf8Encode(AAD_PUSH),
  );
  if (plaintext === null) return null;
  let value: unknown;
  try {
    value = parseJsonText(utf8Decode(plaintext));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const kind = oneOf(PUSH_EVENT_KINDS, value.kind);
  if (
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.desktop !== "string" ||
    !isSafeNonNegative(value.paneId) ||
    !isSafeNonNegative(value.at) ||
    kind === null
  ) {
    return null;
  }
  return clean({
    title: value.title,
    body: value.body,
    paneId: value.paneId,
    kind,
    desktop: value.desktop,
    at: value.at,
  });
}
