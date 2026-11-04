/**
 * Binary peer frames (design §4). First byte is the type. The relay forwards them without reading
 * them. `decodeFrame` returns null for anything it does not understand, so a hostile relay cannot
 * crash a peer with a malformed frame.
 */
import {
  b64urlDecode,
  b64urlEncode,
  concatBytes,
  readU64be,
  u64be,
  utf8Decode,
  utf8Encode,
} from "./encoding";
import { RELAY_MAX_FRAME_BYTES } from "./limits";
import { isPairingId } from "./relay-messages";
import { isRecord, isSafeNonNegative, oneOf, parseJsonText } from "./validate";

export const FRAME_TYPE = {
  hello: 0x01,
  welcome: 0x02,
  sealed: 0x03,
  pairHello: 0x10,
  pairAccept: 0x11,
  pairReject: 0x12,
} as const;

export const SEALED_HEADER_BYTES = 9; // type + 8-byte counter
export const TAG_BYTES = 16;
/** A pairing box carries a few short strings; anything larger is not one. */
const MAX_PAIR_BOX_BYTES = 2048;

export const VERDICTS = ["ok", "update-phone", "update-desktop"] as const;
export const PAIR_REJECT_REASONS = ["expired", "used", "unknown", "bad-proof"] as const;
export type PairRejectReason = (typeof PAIR_REJECT_REASONS)[number];

export interface HelloBody {
  readonly v: number;
  readonly min: number;
  readonly pairingId: string;
  readonly eph: Uint8Array;
  readonly nonce: Uint8Array;
}
export interface WelcomeBody {
  readonly v: number;
  readonly min: number;
  readonly eph: Uint8Array;
  readonly nonce: Uint8Array;
  readonly verdict: (typeof VERDICTS)[number];
}

export type Frame =
  | { readonly type: "hello"; readonly body: HelloBody }
  | { readonly type: "welcome"; readonly body: WelcomeBody }
  | { readonly type: "sealed"; readonly counter: number; readonly ciphertext: Uint8Array }
  | {
      readonly type: "pair-hello";
      readonly phonePublicKey: Uint8Array;
      readonly box: Uint8Array;
    }
  | { readonly type: "pair-accept"; readonly box: Uint8Array }
  | { readonly type: "pair-reject"; readonly reason: PairRejectReason };

function jsonFrame(type: number, value: object): Uint8Array {
  return concatBytes(Uint8Array.of(type), utf8Encode(JSON.stringify(value)));
}

export function encodeFrame(frame: Frame): Uint8Array {
  switch (frame.type) {
    case "hello":
      return jsonFrame(FRAME_TYPE.hello, {
        v: frame.body.v,
        min: frame.body.min,
        pairingId: frame.body.pairingId,
        eph: b64urlEncode(frame.body.eph),
        nonce: b64urlEncode(frame.body.nonce),
      });
    case "welcome":
      return jsonFrame(FRAME_TYPE.welcome, {
        v: frame.body.v,
        min: frame.body.min,
        eph: b64urlEncode(frame.body.eph),
        nonce: b64urlEncode(frame.body.nonce),
        verdict: frame.body.verdict,
      });
    case "sealed":
      return concatBytes(Uint8Array.of(FRAME_TYPE.sealed), u64be(frame.counter), frame.ciphertext);
    case "pair-hello":
      return jsonFrame(FRAME_TYPE.pairHello, {
        ppk: b64urlEncode(frame.phonePublicKey),
        box: b64urlEncode(frame.box),
      });
    case "pair-accept":
      return jsonFrame(FRAME_TYPE.pairAccept, { box: b64urlEncode(frame.box) });
    case "pair-reject":
      return jsonFrame(FRAME_TYPE.pairReject, { reason: frame.reason });
  }
}

function fixed(value: unknown, length: number): Uint8Array | null {
  if (typeof value !== "string") return null;
  try {
    const bytes = b64urlDecode(value);
    return bytes.length === length ? bytes : null;
  } catch {
    return null;
  }
}

function box(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length > MAX_PAIR_BOX_BYTES * 2) return null;
  try {
    const bytes = b64urlDecode(value);
    return bytes.length >= TAG_BYTES && bytes.length <= MAX_PAIR_BOX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

function version(value: unknown): value is number {
  return isSafeNonNegative(value) && value <= 0xffff;
}

export function decodeFrame(bytes: Uint8Array): Frame | null {
  if (bytes.length < 1 || bytes.length > RELAY_MAX_FRAME_BYTES) return null;
  const type = bytes[0];

  if (type === FRAME_TYPE.sealed) {
    if (bytes.length < SEALED_HEADER_BYTES + TAG_BYTES) return null;
    let counter: number;
    try {
      counter = readU64be(bytes, 1);
    } catch {
      return null;
    }
    return { type: "sealed", counter, ciphertext: bytes.subarray(SEALED_HEADER_BYTES) };
  }

  let body: unknown;
  try {
    body = parseJsonText(utf8Decode(bytes.subarray(1)));
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;

  switch (type) {
    case FRAME_TYPE.hello: {
      const eph = fixed(body.eph, 32);
      const nonce = fixed(body.nonce, 16);
      if (!version(body.v) || !version(body.min) || !isPairingId(body.pairingId)) return null;
      if (eph === null || nonce === null) return null;
      return {
        type: "hello",
        body: { v: body.v, min: body.min, pairingId: body.pairingId, eph, nonce },
      };
    }
    case FRAME_TYPE.welcome: {
      const eph = fixed(body.eph, 32);
      const nonce = fixed(body.nonce, 16);
      const verdict = oneOf(VERDICTS, body.verdict);
      if (!version(body.v) || !version(body.min) || eph === null || nonce === null) return null;
      if (verdict === null) return null;
      return { type: "welcome", body: { v: body.v, min: body.min, eph, nonce, verdict } };
    }
    case FRAME_TYPE.pairHello: {
      const phonePublicKey = fixed(body.ppk, 32);
      const sealedBox = box(body.box);
      return phonePublicKey === null || sealedBox === null
        ? null
        : { type: "pair-hello", phonePublicKey, box: sealedBox };
    }
    case FRAME_TYPE.pairAccept: {
      const sealedBox = box(body.box);
      return sealedBox === null ? null : { type: "pair-accept", box: sealedBox };
    }
    case FRAME_TYPE.pairReject: {
      const reason = oneOf(PAIR_REJECT_REASONS, body.reason);
      return reason === null ? null : { type: "pair-reject", reason };
    }
    default:
      return null;
  }
}
