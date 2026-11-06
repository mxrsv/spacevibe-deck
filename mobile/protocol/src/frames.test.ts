import { describe, expect, it } from "vitest";
import { concatBytes, utf8Encode } from "./encoding";
import { decodeFrame, encodeFrame, FRAME_TYPE, type Frame } from "./frames";
import { RELAY_MAX_FRAME_BYTES } from "./limits";

const PAIRING_ID = "AAECAwQFBgcICQoLDA0ODw";
const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill);

const samples: Frame[] = [
  {
    type: "hello",
    body: { v: 1, min: 1, pairingId: PAIRING_ID, eph: bytes(32, 1), nonce: bytes(16, 2) },
  },
  {
    type: "welcome",
    body: { v: 1, min: 1, eph: bytes(32, 3), nonce: bytes(16, 4), verdict: "update-phone" },
  },
  { type: "sealed", counter: 2 ** 40 + 5, ciphertext: bytes(40, 9) },
  { type: "pair-hello", phonePublicKey: bytes(32, 5), box: bytes(60, 6) },
  { type: "pair-accept", box: bytes(50, 7) },
  { type: "pair-reject", reason: "used" },
];

describe("frames", () => {
  it.each(samples)("round-trips a $type frame", (frame) => {
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it("starts each frame with the documented type byte", () => {
    expect(samples.map((frame) => encodeFrame(frame)[0])).toEqual([
      FRAME_TYPE.hello,
      FRAME_TYPE.welcome,
      FRAME_TYPE.sealed,
      FRAME_TYPE.pairHello,
      FRAME_TYPE.pairAccept,
      FRAME_TYPE.pairReject,
    ]);
    expect(FRAME_TYPE).toEqual({
      hello: 1,
      welcome: 2,
      sealed: 3,
      pairHello: 0x10,
      pairAccept: 0x11,
      pairReject: 0x12,
    });
  });

  it("lays a sealed frame out as type, 8-byte big-endian counter, ciphertext", () => {
    const frame = encodeFrame({ type: "sealed", counter: 258, ciphertext: bytes(20, 0xaa) });
    expect(Array.from(frame.subarray(0, 9))).toEqual([3, 0, 0, 0, 0, 0, 0, 1, 2]);
    expect(frame).toHaveLength(29);
  });

  it("returns null for unknown types and empty input", () => {
    expect(decodeFrame(new Uint8Array(0))).toBeNull();
    expect(decodeFrame(Uint8Array.of(0x00))).toBeNull();
    expect(decodeFrame(Uint8Array.of(0x7f, 0x7b, 0x7d))).toBeNull();
    expect(decodeFrame(concatBytes(Uint8Array.of(0x13), utf8Encode("{}")))).toBeNull();
  });

  it("returns null for truncated sealed frames", () => {
    const sealed = encodeFrame(samples[2]);
    expect(decodeFrame(sealed.subarray(0, 8))).toBeNull();
    expect(decodeFrame(sealed.subarray(0, 9 + 15))).toBeNull();
  });

  it("returns null for a sealed counter beyond a safe integer", () => {
    const frame = encodeFrame({ type: "sealed", counter: 1, ciphertext: bytes(20, 1) });
    frame[1] = 0x20;
    expect(decodeFrame(frame)).toBeNull();
  });

  it("returns null for invalid JSON or invalid UTF-8 in a JSON frame", () => {
    for (const type of [0x01, 0x02, 0x10, 0x11, 0x12]) {
      expect(decodeFrame(concatBytes(Uint8Array.of(type), utf8Encode("{nope")))).toBeNull();
      expect(decodeFrame(concatBytes(Uint8Array.of(type), Uint8Array.of(0xff, 0xfe)))).toBeNull();
      expect(decodeFrame(concatBytes(Uint8Array.of(type), utf8Encode("[]")))).toBeNull();
      expect(decodeFrame(Uint8Array.of(type))).toBeNull();
    }
  });

  it("returns null when a field has the wrong shape", () => {
    const json = (type: number, body: object) =>
      concatBytes(Uint8Array.of(type), utf8Encode(JSON.stringify(body)));
    const hello = JSON.parse(new TextDecoder().decode(encodeFrame(samples[0]).subarray(1)));
    expect(decodeFrame(json(1, { ...hello, pairingId: "x" }))).toBeNull();
    expect(decodeFrame(json(1, { ...hello, eph: "AAAA" }))).toBeNull();
    expect(decodeFrame(json(1, { ...hello, v: "1" }))).toBeNull();
    expect(decodeFrame(json(1, { ...hello, v: -1 }))).toBeNull();
    expect(
      decodeFrame(json(2, { v: 1, min: 1, eph: hello.eph, nonce: hello.nonce, verdict: "maybe" })),
    ).toBeNull();
    expect(decodeFrame(json(0x12, { reason: "because" }))).toBeNull();
    expect(decodeFrame(json(0x11, { box: "AAAA" }))).toBeNull();
    expect(decodeFrame(json(0x10, { ppk: hello.eph }))).toBeNull();
  });

  it("returns null for a frame over the relay limit", () => {
    expect(decodeFrame(concatBytes(Uint8Array.of(3), bytes(RELAY_MAX_FRAME_BYTES, 0)))).toBeNull();
  });
});
