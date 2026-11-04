import { describe, expect, it } from "vitest";
import {
  createDesktopChannel,
  createPhoneChannel,
  type AppObject,
  type DesktopChannel,
  type PhoneChannel,
} from "./channel";
import { createNodeCrypto } from "./crypto-node";
import { concatBytes, randomId, u64be, utf8Encode } from "./encoding";
import { decodeFrame, encodeFrame } from "./frames";
import { deriveSessionKeys } from "./keys";
import { MAX_AUTH_FAILURES, MAX_MESSAGE_BYTES } from "./limits";
import type { VersionVerdict } from "./version";

const crypto = createNodeCrypto();

interface Rig {
  readonly phone: PhoneChannel;
  readonly desktop: DesktopChannel;
  /** Frames each side sent and the other has not received yet. */
  readonly toDesktop: Uint8Array[];
  readonly toPhone: Uint8Array[];
  readonly phoneSeen: AppObject[];
  readonly desktopSeen: AppObject[];
  deliver(): void;
}

function rig(
  options: {
    phoneRange?: { version: number; min: number };
    desktopRange?: { version: number; min: number };
    knownPairKey?: Uint8Array | null;
  } = {},
): Rig {
  const pairingId = randomId(crypto);
  const pairKey = crypto.randomBytes(32);
  const toDesktop: Uint8Array[] = [];
  const toPhone: Uint8Array[] = [];
  const phone = createPhoneChannel({
    crypto,
    pairing: { pairingId, pairKey },
    send: (frame) => toDesktop.push(frame),
    session: { device: "Test Phone", appVersion: "0.1.0" },
    local: options.phoneRange,
  });
  const desktop = createDesktopChannel({
    crypto,
    lookup: (id) =>
      id === pairingId
        ? options.knownPairKey === undefined
          ? pairKey
          : options.knownPairKey
        : null,
    send: (frame) => toPhone.push(frame),
    local: options.desktopRange,
  });
  const phoneSeen: AppObject[] = [];
  const desktopSeen: AppObject[] = [];
  phone.onMessage((message) => phoneSeen.push(message));
  desktop.onMessage((message) => desktopSeen.push(message));
  return {
    phone,
    desktop,
    toDesktop,
    toPhone,
    phoneSeen,
    desktopSeen,
    deliver() {
      while (toDesktop.length > 0 || toPhone.length > 0) {
        for (const frame of toDesktop.splice(0)) desktop.receive(frame);
        for (const frame of toPhone.splice(0)) phone.receive(frame);
      }
    },
  };
}

function open(): Rig {
  const r = rig();
  r.phone.start();
  r.deliver();
  return r;
}

describe("handshake", () => {
  it("opens both ends and delivers session.start to the desktop", () => {
    const r = rig();
    expect(r.phone.state).toBe("handshaking");
    r.phone.start();
    r.deliver();
    expect(r.phone.state).toBe("open");
    expect(r.desktop.state).toBe("open");
    expect(r.desktop.verdict).toBe("ok");
    expect(r.desktop.phone).toEqual({ device: "Test Phone", appVersion: "0.1.0" });
    expect(r.desktopSeen).toEqual([
      { ev: "session.start", p: { device: "Test Phone", appVersion: "0.1.0" } },
    ]);
  });

  it("sends nothing from the desktop after hello except welcome, until the phone's first frame opened", () => {
    const r = rig();
    r.phone.start();
    r.desktop.receive(r.toDesktop.splice(0)[0]);
    expect(r.desktop.state).toBe("handshaking");
    expect(r.toPhone).toHaveLength(1);
    expect(decodeFrame(r.toPhone[0])?.type).toBe("welcome");
    expect(r.desktop.sendMessage({ ev: "tree", p: {} })).toBe("not-open");
    expect(r.toPhone).toHaveLength(1);
    expect(r.desktopSeen).toEqual([]);
  });

  it("never delivers an app message from a peer that cannot open frames", () => {
    const r = rig();
    r.phone.start();
    r.desktop.receive(r.toDesktop.splice(0)[0]);
    // A relay with no key invents a sealed frame in the phone's name.
    r.desktop.receive(
      encodeFrame({ type: "sealed", counter: 0, ciphertext: crypto.randomBytes(80) }),
    );
    expect(r.desktopSeen).toEqual([]);
    expect(r.desktop.state).toBe("handshaking");
    expect(r.desktop.failures).toBe(1);
    expect(r.desktop.sendMessage({ ev: "desktop", p: {} })).toBe("not-open");
  });

  /** A hand-driven phone, so a test can seal whatever it wants as the first frame. */
  function forgePhone(plaintext: Uint8Array) {
    const pairingId = randomId(crypto);
    const pairKey = crypto.randomBytes(32);
    const sent: Uint8Array[] = [];
    const desktop = createDesktopChannel({
      crypto,
      lookup: () => pairKey,
      send: (frame) => sent.push(frame),
    });
    const ephemeral = crypto.x25519KeyPair();
    const hello = encodeFrame({
      type: "hello",
      body: { v: 1, min: 1, pairingId, eph: ephemeral.publicKey, nonce: crypto.randomBytes(16) },
    });
    desktop.receive(hello);
    const welcomeBytes = sent[0];
    const welcome = decodeFrame(welcomeBytes);
    if (welcome?.type !== "welcome") throw new Error("expected welcome");
    const keys = deriveSessionKeys(crypto, {
      pairKey,
      ownEphemeralSecret: ephemeral.secretKey,
      peerEphemeralPublic: welcome.body.eph,
      helloFrame: hello,
      welcomeFrame: welcomeBytes,
    });
    const counter = u64be(0);
    const sealed = crypto.seal(
      keys.p2d,
      concatBytes(new Uint8Array(4), counter),
      plaintext,
      concatBytes(Uint8Array.of(3), counter),
    );
    desktop.receive(encodeFrame({ type: "sealed", counter: 0, ciphertext: sealed }));
    return desktop;
  }

  it("closes when the first authentic frame is not session.start", () => {
    const desktop = forgePhone(utf8Encode(JSON.stringify({ id: 1, m: "tree.subscribe", p: {} })));
    const seen: AppObject[] = [];
    desktop.onMessage((message) => seen.push(message));
    expect(desktop.state).toBe("closed");
    expect(desktop.closeReason).toBe("protocol-error");
    expect(seen).toEqual([]);
  });

  it("closes when the first authentic frame is not a JSON object", () => {
    const desktop = forgePhone(utf8Encode("[1,2,3]"));
    expect(desktop.state).toBe("handshaking");
    expect(desktop.failures).toBe(1);
    expect(forgePhone(utf8Encode("not json")).failures).toBe(1);
  });

  it("accepts a hand-built session.start, proving the forge helper speaks the real protocol", () => {
    const desktop = forgePhone(
      utf8Encode(JSON.stringify({ ev: "session.start", p: { device: "d", appVersion: "1" } })),
    );
    expect(desktop.state).toBe("open");
  });

  it("closes the desktop on an unknown pairing and answers nothing", () => {
    const r = rig({ knownPairKey: null });
    r.phone.start();
    r.deliver();
    expect(r.desktop.state).toBe("closed");
    expect(r.desktop.closeReason).toBe("unknown-pairing");
    expect(r.toPhone).toHaveLength(0);
    expect(r.desktop.pairingId).toBeNull();
  });

  it("refuses a second hello", () => {
    const r = rig();
    r.phone.start();
    const hello = r.toDesktop[0];
    r.desktop.receive(hello);
    r.desktop.receive(hello);
    expect(r.desktop.failures).toBe(1);
    expect(r.toPhone).toHaveLength(1);
  });

  it("derives no common key when the relay swaps the desktop's ephemeral key", () => {
    const r = rig();
    r.phone.start();
    r.desktop.receive(r.toDesktop.splice(0)[0]);
    const welcome = decodeFrame(r.toPhone.splice(0)[0]);
    if (welcome?.type !== "welcome") throw new Error("expected welcome");
    const forged = encodeFrame({
      type: "welcome",
      body: { ...welcome.body, eph: crypto.x25519KeyPair().publicKey },
    });
    r.phone.receive(forged);
    r.deliver();
    expect(r.desktop.failures).toBe(1); // the phone's session.start would not open
    expect(r.desktop.state).toBe("handshaking");
    expect(r.desktopSeen).toEqual([]);
  });

  it("breaks the keys when the relay edits the version fields of welcome", () => {
    const r = rig();
    r.phone.start();
    r.desktop.receive(r.toDesktop.splice(0)[0]);
    const welcome = decodeFrame(r.toPhone.splice(0)[0]);
    if (welcome?.type !== "welcome") throw new Error("expected welcome");
    r.phone.receive(encodeFrame({ type: "welcome", body: { ...welcome.body, v: 7 } }));
    r.deliver();
    expect(r.desktopSeen).toEqual([]);
    expect(r.desktop.failures).toBe(1);
  });

  it("opens a second session of the same pairing with different keys", () => {
    const a = open();
    expect(a.phone.state).toBe("open");
    const b = open();
    expect(b.toDesktop).toHaveLength(0);
    expect(b.desktop.state).toBe("open");
  });
});

describe("version verdicts", () => {
  const cases: [
    string,
    { version: number; min: number },
    { version: number; min: number },
    VersionVerdict,
  ][] = [
    ["same version", { version: 1, min: 1 }, { version: 1, min: 1 }, "ok"],
    [
      "newer phone, older desktop within range",
      { version: 3, min: 1 },
      { version: 2, min: 1 },
      "ok",
    ],
    [
      "a phone below the desktop minimum",
      { version: 1, min: 1 },
      { version: 3, min: 2 },
      "update-phone",
    ],
    [
      "a desktop below the phone minimum",
      { version: 3, min: 2 },
      { version: 1, min: 1 },
      "update-desktop",
    ],
  ];

  it.each(cases)("%s", (_name, phoneRange, desktopRange, verdict) => {
    const r = rig({ phoneRange, desktopRange });
    r.phone.start();
    r.deliver();
    expect(r.phone.verdict).toBe(verdict);
    expect(r.desktop.verdict).toBe(verdict);
    // An "ok" verdict leaves both open; any other closes both with the verdict as the reason.
    const expectedState = verdict === "ok" ? "open" : "closed";
    const expectedReason = verdict === "ok" ? null : verdict;
    expect([r.phone.state, r.desktop.state]).toEqual([expectedState, expectedState]);
    expect([r.phone.closeReason, r.desktop.closeReason]).toEqual([expectedReason, expectedReason]);
    expect(r.desktopSeen.length).toBe(verdict === "ok" ? 1 : 0);
  });

  it("lets the phone's own judgement override a desktop that claims ok", () => {
    const sent: Uint8Array[] = [];
    const phone = createPhoneChannel({
      crypto,
      pairing: { pairingId: randomId(crypto), pairKey: crypto.randomBytes(32) },
      send: (frame) => sent.push(frame),
      session: { device: "d", appVersion: "1" },
      local: { version: 1, min: 1 },
    });
    phone.start();
    phone.receive(
      encodeFrame({
        type: "welcome",
        body: {
          v: 5,
          min: 4,
          eph: crypto.x25519KeyPair().publicKey,
          nonce: crypto.randomBytes(16),
          verdict: "ok",
        },
      }),
    );
    expect(phone.verdict).toBe("update-phone");
    expect(phone.state).toBe("closed");
    expect(sent).toHaveLength(1); // only the hello; no session.start went out
  });
});

describe("sealed traffic", () => {
  it("carries messages both ways in order", () => {
    const r = open();
    r.desktopSeen.length = 0;
    expect(r.desktop.sendMessage({ ev: "tree", p: { n: 1 } })).toBe("sent");
    expect(r.desktop.sendMessage({ ev: "tree", p: { n: 2 } })).toBe("sent");
    expect(r.phone.sendMessage({ id: 1, m: "usage.get", p: {} })).toBe("sent");
    r.deliver();
    expect(r.phoneSeen).toEqual([
      { ev: "tree", p: { n: 1 } },
      { ev: "tree", p: { n: 2 } },
    ]);
    expect(r.desktopSeen).toEqual([{ id: 1, m: "usage.get", p: {} }]);
    expect(r.phone.failures + r.desktop.failures).toBe(0);
  });

  it("uses an 8-byte counter that starts at zero for each direction", () => {
    const r = open();
    r.desktop.sendMessage({ ev: "a", p: {} });
    r.desktop.sendMessage({ ev: "b", p: {} });
    const counters = r.toPhone.map((frame) => {
      const decoded = decodeFrame(frame);
      return decoded?.type === "sealed" ? decoded.counter : -1;
    });
    expect(counters).toEqual([0, 1]);
  });

  it("drops and counts a tampered frame, and the genuine one still works afterwards", () => {
    const r = open();
    r.desktop.sendMessage({ ev: "tree", p: { n: 1 } });
    const genuine = r.toPhone.splice(0)[0];
    const tampered = genuine.slice();
    tampered[tampered.length - 1] ^= 1;
    r.phone.receive(tampered);
    expect(r.phoneSeen).toEqual([]);
    expect(r.phone.failures).toBe(1);
    r.phone.receive(genuine);
    expect(r.phoneSeen).toEqual([{ ev: "tree", p: { n: 1 } }]);
    expect(r.phone.state).toBe("open");
  });

  it("drops a frame whose counter field was edited, because the AAD covers it", () => {
    const r = open();
    r.desktop.sendMessage({ ev: "x", p: {} });
    const frame = r.toPhone.splice(0)[0].slice();
    frame[8] = 5;
    r.phone.receive(frame);
    expect(r.phoneSeen).toEqual([]);
    expect(r.phone.failures).toBe(1);
  });

  it("drops a replayed frame and a frame that skips ahead", () => {
    const r = open();
    r.desktop.sendMessage({ ev: "x", p: { n: 1 } });
    r.desktop.sendMessage({ ev: "x", p: { n: 2 } });
    r.desktop.sendMessage({ ev: "x", p: { n: 3 } });
    const [first, second, third] = r.toPhone.splice(0);
    r.phone.receive(first);
    r.phone.receive(first); // replay
    r.phone.receive(third); // skip
    r.phone.receive(second);
    r.phone.receive(third);
    expect(r.phoneSeen.map((m) => (m.p as { n: number }).n)).toEqual([1, 2, 3]);
    expect(r.phone.failures).toBe(2);
  });

  it("does not accept a frame reflected back to its sender", () => {
    const r = open();
    r.phone.sendMessage({ id: 1, m: "usage.get", p: {} });
    const frame = r.toDesktop.splice(0)[0];
    r.phone.receive(frame); // directions use different keys
    expect(r.phoneSeen).toEqual([]);
    expect(r.phone.failures).toBe(1);
  });

  it("closes after MAX_AUTH_FAILURES bad frames and then ignores everything", () => {
    const r = open();
    const states: string[] = [];
    r.phone.onState((state, reason) => states.push(`${state}:${reason}`));
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) r.phone.receive(crypto.randomBytes(40));
    expect(r.phone.state).toBe("open");
    r.phone.receive(crypto.randomBytes(40));
    expect(r.phone.state).toBe("closed");
    expect(r.phone.closeReason).toBe("auth-failures");
    expect(states).toEqual(["closed:auth-failures"]);
    r.desktop.sendMessage({ ev: "late", p: {} });
    r.deliver();
    expect(r.phoneSeen).toEqual([]);
    expect(r.phone.sendMessage({ id: 1, m: "usage.get", p: {} })).toBe("not-open");
  });

  it("counts garbage that is not even a frame", () => {
    const r = open();
    r.phone.receive(new Uint8Array(0));
    r.phone.receive(Uint8Array.of(0x55, 1, 2));
    r.phone.receive(Uint8Array.of(0x03, 1));
    expect(r.phone.failures).toBe(3);
  });

  it("refuses to send a message over MAX_MESSAGE_BYTES", () => {
    const r = open();
    expect(r.phone.sendMessage({ ev: "x", p: { data: "a".repeat(MAX_MESSAGE_BYTES) } })).toBe(
      "too-large",
    );
    expect(r.toDesktop).toHaveLength(0);
    expect(r.phone.sendMessage({ ev: "x", p: { data: "a".repeat(MAX_MESSAGE_BYTES - 100) } })).toBe(
      "sent",
    );
  });

  it("reports state changes once and lets a listener unsubscribe", () => {
    const r = rig();
    const seen: string[] = [];
    const stop = r.phone.onState((state) => seen.push(state));
    r.phone.start();
    r.deliver();
    stop();
    r.phone.close("user");
    expect(seen).toEqual(["open"]);
    expect(r.phone.closeReason).toBe("user");
  });

  it("close is idempotent and keeps the first reason", () => {
    const r = open();
    r.desktop.close("first");
    r.desktop.close("second");
    expect(r.desktop.closeReason).toBe("first");
  });
});
