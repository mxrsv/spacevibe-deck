import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPhoneChannel } from "../../mobile/protocol/src/channel";
import { createNodeCrypto } from "../../mobile/protocol/src/crypto-node";
import { derivePushKey } from "../../mobile/protocol/src/keys";
import { createPairHello, openPairAccept } from "../../mobile/protocol/src/pairing";
import { openPush } from "../../mobile/protocol/src/push";
import { parsePairingQr } from "../../mobile/protocol/src/qr";
import type { SessionCipher, SessionFileIo } from "../account/session-store";
import { createPaneMirror } from "../control/pane-mirror";
import { createPairingStore } from "./pairing-store";
import type { RelaySocket } from "./relay-client";
import { createMobileService } from "./service";

const crypto = createNodeCrypto();

class FakeSocket implements RelaySocket {
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  onopen: RelaySocket["onopen"] = null;
  onmessage: RelaySocket["onmessage"] = null;
  onclose: RelaySocket["onclose"] = null;
  onerror: RelaySocket["onerror"] = null;
  closed = false;
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  toDesktop(bytes: Uint8Array): void {
    this.onmessage?.({
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  }
  control(value: object): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  binaries(): Uint8Array[] {
    return this.sent.filter((item): item is Uint8Array => typeof item !== "string");
  }
  controls(): Record<string, unknown>[] {
    return this.sent
      .filter((item): item is string => typeof item === "string")
      .map((text) => JSON.parse(text));
  }
}

function setup() {
  const file = { text: null as string | null };
  const io: SessionFileIo = {
    read: async () => file.text,
    write: async (text) => {
      file.text = text;
    },
    remove: async () => {
      file.text = null;
    },
  };
  const cipher: SessionCipher = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain),
    decryptString: (buf) => buf.toString(),
  };
  const sockets: FakeSocket[] = [];
  const blocker = { start: vi.fn(() => 3), stop: vi.fn() };
  const mirror = createPaneMirror({ now: () => Date.now() });
  const focus = { any: false };
  const changed = vi.fn();
  const service = createMobileService({
    crypto,
    store: createPairingStore({ io, cipher }),
    relayUrl: () => "https://relay.example/relay",
    fetch: async () => ({ status: 201 }),
    appVersion: "9.9.9",
    platform: "darwin",
    mirror,
    windows: {
      ownerOf: () => null,
      deliver: () => {},
      emitTo: () => true,
      labels: () => [],
      focused: () => null,
      main: () => null,
      anyFocused: () => focus.any,
    },
    usage: async () => ({ scannedAtMs: 0, buckets: [], sources: [], skippedLines: 0 }),
    blocker,
    broadcastChanged: changed,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    log: vi.fn(),
  });
  return { service, sockets, blocker, mirror, focus, changed, file };
}

async function pairPhone(t: ReturnType<typeof setup>) {
  await t.service.start();
  const started = await t.service.pairStart();
  if (started.pending === null) throw new Error("expected a pending pairing");
  const qr = parsePairingQr(started.pending.qr, Date.now());
  if (!qr.ok) throw new Error("bad qr");
  const socket = t.sockets[0]!;
  socket.onopen?.({});
  socket.control({ t: "ready", role: "desktop", peerOnline: true, peerLastSeen: null });
  const attempt = createPairHello(crypto, qr.value, {
    name: "Mark's iPhone",
    model: "iPhone",
    os: "ios",
    v: 1,
  });
  socket.toDesktop(attempt.frame);
  await vi.waitFor(() => expect(socket.binaries()).toHaveLength(1));
  return { socket, qr: qr.value, attempt };
}

describe("mobile service", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("pairs a phone over the pending pairing's own relay socket", async () => {
    const t = setup();
    const { socket, attempt } = await pairPhone(t);
    expect(openPairAccept(crypto, attempt, socket.binaries()[0]!)).toMatchObject({
      ok: true,
      desktop: { os: "macos", appVersion: "9.9.9" },
    });
    expect(t.service.state()).toMatchObject({
      enabled: true,
      pending: null,
      phones: [{ name: "Mark's iPhone", model: "iPhone", online: true }],
    });
    expect(JSON.parse(String(socket.sent[0]))).toMatchObject({ t: "auth", role: "desktop" });
    expect(t.file.text).not.toContain("pairKey");
  });

  it("opens a session when the phone says hello, and answers its requests", async () => {
    const t = setup();
    const { socket, qr, attempt } = await pairPhone(t);
    const phone = createPhoneChannel({
      crypto,
      pairing: { pairingId: qr.pairingId, pairKey: attempt.pairKey },
      send: (frame) => socket.toDesktop(frame),
      session: { device: "iPhone", appVersion: "1" },
    });
    const received: Record<string, unknown>[] = [];
    phone.onMessage((message) => received.push(message));
    // Everything after the pair-accept is the session's.
    let consumed = 1;
    const drain = () => {
      const frames = socket.binaries();
      while (consumed < frames.length) phone.receive(frames[consumed++]!);
    };
    phone.start();
    drain();
    drain();
    expect(received[0]).toMatchObject({
      ev: "desktop",
      p: { os: "macos", appVersion: "9.9.9", lan: [] },
    });
    const before = socket.binaries().length;
    phone.sendMessage({ id: 1, m: "tree.unsubscribe", p: {} });
    await vi.waitFor(() => expect(socket.binaries().length).toBeGreaterThan(before));
    drain();
    expect(received.at(-1)).toEqual({ id: 1, ok: true, r: {} });
  });

  it("seals a push for the phone only while no Deck window is focused", async () => {
    const t = setup();
    const { socket, attempt } = await pairPhone(t);
    t.focus.any = true;
    t.service.push({ paneId: 3, kind: "requested", title: "deck", body: "Claude needs attention" });
    expect(socket.controls().filter((m) => m.t === "push")).toEqual([]);
    t.focus.any = false;
    t.service.push({ paneId: 3, kind: "requested", title: "deck", body: "Claude needs attention" });
    const pushes = socket.controls().filter((m) => m.t === "push");
    expect(pushes).toHaveLength(1);
    const opened = openPush(
      crypto,
      derivePushKey(crypto, attempt.pairKey),
      String(pushes[0]!.data),
    );
    expect(opened).toMatchObject({
      title: "deck",
      body: "Claude needs attention",
      paneId: 3,
      kind: "requested",
    });
    expect(JSON.stringify(pushes[0])).not.toContain("Claude needs attention");
  });

  it("revoking tells the relay, closes the session and forgets the phone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const t = setup();
    const { socket } = await pairPhone(t);
    const state = await t.service.revoke(t.service.state().phones[0]!.pairingId);
    expect(state.phones).toEqual([]);
    expect(socket.controls().some((m) => m.t === "revoke")).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(socket.closed).toBe(true);
  });

  it("keeps the Mac awake only while a pane works and a phone is paired", async () => {
    const t = setup();
    const observed = t.service.observeMirror(t.mirror);
    const report = (phase: "working" | "idle") =>
      observed.report(5, {
        phase,
        attention: "none",
        source: null,
        confidence: "explicit",
        agent: "claude",
        pid: 4,
      });
    report("working");
    expect(t.blocker.start).not.toHaveBeenCalled();
    await pairPhone(t);
    // Pairing with a pane already working starts it; idle releases it; work resumes.
    expect(t.blocker.start).toHaveBeenCalledOnce();
    report("idle");
    expect(t.blocker.stop).toHaveBeenCalledWith(3);
    report("working");
    expect(t.blocker.start).toHaveBeenCalledTimes(2);
  });

  it("closes sockets and the blocker on dispose", async () => {
    const t = setup();
    const { socket } = await pairPhone(t);
    t.service.dispose();
    expect(socket.closed).toBe(true);
    t.service.push({ paneId: 1, kind: "completed", title: "x", body: "y" });
    expect(socket.controls().filter((m) => m.t === "push")).toEqual([]);
  });
});
