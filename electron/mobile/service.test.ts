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

interface SetupOptions {
  readonly lan?: NonNullable<Parameters<typeof createMobileService>[0]["lan"]>;
  readonly labels?: readonly string[];
  /** Reuse a previous run's file, to model a restart. */
  readonly file?: { text: string | null };
}

function setup(options: SetupOptions = {}) {
  const { lan } = options;
  const queries: string[] = [];
  const file = options.file ?? { text: null as string | null };
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
      emitTo: (label, event, payload) => {
        if (event === "mobile:query-request") {
          const { requestId, kind } = payload as { requestId: string; kind: "tree" };
          queries.push(kind);
          // The renderer answers at once, so a tree poll completes without waiting out a timeout.
          queueMicrotask(() => service.settleQuery(label, requestId, kind, { projects: [] }));
        }
        return true;
      },
      labels: () => options.labels ?? [],
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
    ...(lan === undefined ? {} : { lan }),
    log: vi.fn(),
  });
  return { service, sockets, blocker, mirror, focus, changed, file, queries };
}

async function pairPhone(t: ReturnType<typeof setup>, index = 0) {
  if (index === 0) await t.service.start();
  const started = await t.service.pairStart();
  if (started.pending === null) throw new Error("expected a pending pairing");
  const qr = parsePairingQr(started.pending.qr, Date.now());
  if (!qr.ok) throw new Error("bad qr");
  const socket = t.sockets[index]!;
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

  it("revoking tells the relay and, once the relay answers, closes the socket and drops the record", async () => {
    const t = setup();
    const { socket } = await pairPhone(t);
    const state = await t.service.revoke(t.service.state().phones[0]!.pairingId);
    expect(state.phones).toEqual([]);
    expect(socket.controls().some((m) => m.t === "revoke")).toBe(true);
    expect(socket.closed).toBe(false);
    socket.control({ t: "revoked" });
    socket.onclose?.({ code: 4410 });
    await vi.waitFor(() => expect(socket.closed).toBe(true));
    await vi.waitFor(() => expect(t.file.text).toBeNull());
    const reopened = setup({ file: t.file });
    await reopened.service.start();
    expect(reopened.sockets).toHaveLength(0);
  });

  it("a revoke made while the socket is down is sent after reconnect and ready, and retried after a restart", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const t = setup();
    const { socket } = await pairPhone(t);
    socket.onclose?.({ code: 1006 });
    const id = t.service.state().phones[0]!.pairingId;
    const state = await t.service.revoke(id);
    // Access ends at once, even though the relay has not heard.
    expect(state.phones).toEqual([]);
    expect(socket.controls().some((m) => m.t === "revoke")).toBe(false);
    vi.advanceTimersByTime(2_000);
    const second = t.sockets[1]!;
    second.onopen?.({});
    // Nothing but `auth` goes out before the relay says ready.
    expect(second.controls().map((m) => m.t)).toEqual(["auth"]);
    second.control({ t: "ready", role: "desktop", peerOnline: false, peerLastSeen: null });
    expect(second.controls().map((m) => m.t)).toEqual(["auth", "revoke"]);

    // The app quits before the relay answers: the next start tries again.
    const restarted = setup({ file: t.file });
    await restarted.service.start();
    const third = restarted.sockets[0]!;
    third.onopen?.({});
    third.control({ t: "ready", role: "desktop", peerOnline: false, peerLastSeen: null });
    expect(third.controls().some((m) => m.t === "revoke")).toBe(true);
    third.control({ t: "error", code: "unknown" });
    third.onclose?.({ code: 4404 });
    await vi.waitFor(() => expect(t.file.text).toBeNull());
    const again = setup({ file: t.file });
    await again.service.start();
    expect(again.sockets).toHaveLength(0);
  });

  it("a hello for another pairing on this socket never opens a session, and revoking that pairing stays final", async () => {
    const t = setup();
    const a = await pairPhone(t);
    const b = await pairPhone(t, 1);
    const received: Record<string, unknown>[] = [];
    const phoneB = createPhoneChannel({
      crypto,
      pairing: { pairingId: b.qr.pairingId, pairKey: b.attempt.pairKey },
      send: (frame) => a.socket.toDesktop(frame),
      session: { device: "iPhone", appVersion: "1" },
    });
    phoneB.onMessage((message) => received.push(message));
    const before = a.socket.binaries().length;
    phoneB.start();
    await t.service.revoke(b.qr.pairingId);
    phoneB.sendMessage({ id: 7, m: "tree.unsubscribe", p: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The desktop never answered B's hello with a welcome, so no key was ever derived.
    expect(a.socket.binaries().length).toBe(before);
    for (const frame of a.socket.binaries().slice(before)) phoneB.receive(frame);
    expect(received.some((message) => message.id === 7)).toBe(false);
  });

  it("closes the session, and stops polling, when the relay reports the phone offline", async () => {
    vi.useFakeTimers();
    const t = setup({ labels: ["w1"] });
    const { socket, qr, attempt } = await pairPhone(t);
    const phone = createPhoneChannel({
      crypto,
      pairing: { pairingId: qr.pairingId, pairKey: attempt.pairKey },
      send: (frame) => socket.toDesktop(frame),
      session: { device: "iPhone", appVersion: "1" },
    });
    let consumed = 1;
    const drain = () => {
      const frames = socket.binaries();
      while (consumed < frames.length) phone.receive(frames[consumed++]!);
    };
    phone.start();
    drain();
    drain();
    phone.sendMessage({ id: 1, m: "tree.subscribe", p: {} });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(2_100);
    const polled = t.queries.length;
    expect(polled).toBeGreaterThan(1);

    socket.control({ t: "peer", online: false, lastSeen: 1 });
    await vi.advanceTimersByTimeAsync(10);
    const settled = t.queries.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.queries.length).toBe(settled);
  });

  it("a revoke from the phone ends its session and its polling before the link is dropped", async () => {
    vi.useFakeTimers();
    const t = setup({ labels: ["w1"] });
    const { socket, qr, attempt } = await pairPhone(t);
    const phone = createPhoneChannel({
      crypto,
      pairing: { pairingId: qr.pairingId, pairKey: attempt.pairKey },
      send: (frame) => socket.toDesktop(frame),
      session: { device: "iPhone", appVersion: "1" },
    });
    let consumed = 1;
    const drain = () => {
      const frames = socket.binaries();
      while (consumed < frames.length) phone.receive(frames[consumed++]!);
    };
    phone.start();
    drain();
    drain();
    phone.sendMessage({ id: 1, m: "tree.subscribe", p: {} });
    await vi.advanceTimersByTimeAsync(2_100);
    socket.control({ t: "revoked" });
    socket.onclose?.({ code: 4410 });
    await vi.advanceTimersByTimeAsync(50);
    const settled = t.queries.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.queries.length).toBe(settled);
    expect(t.service.state().phones).toEqual([]);
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

  describe("LAN path (MOB9)", () => {
    // A test cannot bind a LAN address, so loopback stands in for the private interface.
    const loopback = {
      listInterfaces: () => ({
        lo: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4" as const,
            mac: "00:00:00:00:00:00",
            internal: false,
            cidr: "127.0.0.1/8",
          },
        ],
      }),
      isAllowed: (address: string) => address === "127.0.0.1",
    };

    /** Everything a real phone would do over the LAN socket, with the real channel. */
    async function lanPhone(
      t: ReturnType<typeof setup>,
      paired: Awaited<ReturnType<typeof pairPhone>>,
      port: number,
    ) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/${paired.qr.pairingId}/socket`);
      socket.binaryType = "arraybuffer";
      const received: Record<string, unknown>[] = [];
      const phone = createPhoneChannel({
        crypto,
        pairing: { pairingId: paired.qr.pairingId, pairKey: paired.attempt.pairKey },
        send: (frame) => socket.send(frame),
        session: { device: "iPhone", appVersion: "1" },
      });
      phone.onMessage((message) => received.push(message));
      socket.onmessage = (event) => phone.receive(new Uint8Array(event.data as ArrayBuffer));
      await new Promise((resolve) => (socket.onopen = resolve));
      phone.start();
      return { socket, phone, received, t };
    }

    it("serves a phone over a real socket with the same channel and offers the address", async () => {
      const t = setup({ lan: loopback });
      const paired = await pairPhone(t);
      await vi.waitFor(() => expect(t.service.lanAddresses()).toHaveLength(1));
      const [{ port }] = t.service.lanAddresses() as [{ port: number }];
      const lan = await lanPhone(t, paired, port);
      await vi.waitFor(() => expect(lan.phone.state).toBe("open"));
      await vi.waitFor(() =>
        expect(lan.received[0]).toMatchObject({
          ev: "desktop",
          p: { os: "macos", appVersion: "9.9.9", lan: [{ host: "127.0.0.1", port }] },
        }),
      );
      lan.phone.sendMessage({ id: 1, m: "tree.unsubscribe", p: {} });
      await vi.waitFor(() => expect(lan.received.at(-1)).toEqual({ id: 1, ok: true, r: {} }));
      lan.socket.close();
      t.service.dispose();
    });

    it("tells open sessions when the address set changes, and each transport has its own session", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      let up = true;
      const t = setup({
        lan: {
          ...loopback,
          listInterfaces: () => (up ? loopback.listInterfaces() : {}),
          refreshMs: 1_000,
        },
      });
      const paired = await pairPhone(t);
      await vi.waitFor(() => expect(t.service.lanAddresses()).toHaveLength(1));
      const [{ port }] = t.service.lanAddresses() as [{ port: number }];
      const lan = await lanPhone(t, paired, port);
      await vi.waitFor(() => expect(lan.phone.state).toBe("open"));
      up = false;
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() =>
        expect(lan.received.filter((m) => m.ev === "desktop").at(-1)).toMatchObject({
          p: { lan: [] },
        }),
      );
      lan.socket.close();
      t.service.dispose();
    });

    it("stops listening when the last phone is revoked, and closes its LAN session", async () => {
      const t = setup({ lan: loopback });
      const paired = await pairPhone(t);
      await vi.waitFor(() => expect(t.service.lanAddresses()).toHaveLength(1));
      const [{ port }] = t.service.lanAddresses() as [{ port: number }];
      const lan = await lanPhone(t, paired, port);
      await vi.waitFor(() => expect(lan.phone.state).toBe("open"));
      const gone = new Promise<void>((resolve) => (lan.socket.onclose = () => resolve()));
      await t.service.revoke(paired.qr.pairingId);
      await gone;
      expect(t.service.lanAddresses()).toEqual([]);
      const late = new WebSocket(`ws://127.0.0.1:${port}/v1/${paired.qr.pairingId}/socket`);
      await new Promise((resolve) => (late.onerror = resolve));
    });

    it("does not listen with no phone paired, starts on pairing and stops on dispose", async () => {
      const t = setup({ lan: loopback });
      await t.service.start();
      expect(t.service.lanAddresses()).toEqual([]);
      await pairPhone(t);
      await vi.waitFor(() => expect(t.service.lanAddresses()).toHaveLength(1));
      t.service.dispose();
      expect(t.service.lanAddresses()).toEqual([]);
    });
  });
});
