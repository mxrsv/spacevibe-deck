import { describe, expect, it, vi } from "vitest";
import { createPhoneChannel } from "../../mobile/protocol/src/channel";
import { createNodeCrypto } from "../../mobile/protocol/src/crypto-node";
import { randomId } from "../../mobile/protocol/src/encoding";
import { okResponse } from "../../mobile/protocol/src/messages";
import { createPhoneSession } from "./phone-session";
import type { PhoneExecutor } from "./phone-executor";

const crypto = createNodeCrypto();

function pair(options: { phoneVersion?: { version: number; min: number } } = {}) {
  const pairingId = randomId(crypto);
  const pairKey = crypto.randomBytes(32);
  const handled: unknown[] = [];
  const closedSessions: string[] = [];
  const executor: PhoneExecutor = {
    handle: async (_session, request) => {
      handled.push(request);
      return { response: okResponse(request.id, { echoed: request.m }), chunks: [] };
    },
    closeSession: (id) => closedSessions.push(id),
  };
  const opened: string[] = [];
  const closed: (string | null)[] = [];
  const toPhone: Uint8Array[] = [];
  const session = createPhoneSession({
    crypto,
    lookup: (id) => (id === pairingId ? pairKey : null),
    send: (frame) => toPhone.push(frame),
    executor,
    hello: () => ({ name: "Mac", os: "macos", appVersion: "1.0.0", lan: [] }),
    log: vi.fn(),
    onOpen: (id) => opened.push(id),
    onClosed: (reason) => closed.push(reason),
  });
  const fromPhone: Uint8Array[] = [];
  const phone = createPhoneChannel({
    crypto,
    pairing: { pairingId, pairKey },
    send: (frame) => {
      fromPhone.push(frame);
      session.receive(frame);
    },
    session: { device: "iPhone", appVersion: "1" },
    ...(options.phoneVersion === undefined ? {} : { local: options.phoneVersion }),
  });
  const received: Record<string, unknown>[] = [];
  phone.onMessage((message) => received.push(message));
  // Deliver everything the desktop produced to the phone, as the relay would.
  const flush = () => {
    while (toPhone.length > 0) phone.receive(toPhone.shift()!);
  };
  return { session, phone, received, flush, handled, opened, closed, closedSessions, toPhone };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("phone session", () => {
  it("opens after the phone's first sealed frame, then sends the desktop event", async () => {
    const t = pair();
    t.phone.start();
    t.flush();
    await tick();
    t.flush();
    expect(t.opened).toHaveLength(1);
    expect(t.received[0]).toMatchObject({
      ev: "desktop",
      p: { name: "Mac", os: "macos", protocol: 1, lan: [] },
    });
  });

  it("answers requests and rejects unknown methods and malformed params with the request id", async () => {
    const t = pair();
    t.phone.start();
    t.flush();
    t.flush();
    t.phone.sendMessage({ id: 1, m: "agents.list", p: {} });
    t.phone.sendMessage({ id: 2, m: "nope", p: {} });
    t.phone.sendMessage({ id: 3, m: "pane.read", p: { paneId: 1, lines: 99999 } });
    await tick();
    t.flush();
    // The executor answers asynchronously, so a malformed request can be answered before an earlier valid one.
    const responses = t.received
      .filter((message) => "ok" in message)
      .sort((a, b) => Number(a.id) - Number(b.id));
    expect(responses).toEqual([
      { id: 1, ok: true, r: { echoed: "agents.list" } },
      { id: 2, ok: false, e: { code: "unknown-method", message: expect.any(String) } },
      { id: 3, ok: false, e: { code: "invalid", message: expect.any(String) } },
    ]);
    expect(t.handled).toHaveLength(1);
  });

  it("refuses a phone from an unknown pairing and tells the executor when it ends", async () => {
    const t = pair();
    const stranger = createPhoneChannel({
      crypto,
      pairing: { pairingId: randomId(crypto), pairKey: crypto.randomBytes(32) },
      send: (frame) => t.session.receive(frame),
      session: { device: "x", appVersion: "1" },
    });
    stranger.start();
    expect(t.session.channel.state).toBe("closed");
    expect(t.closed).toEqual(["unknown-pairing"]);
    expect(t.closedSessions).toHaveLength(1);
  });

  it("answers an incompatible phone with a verdict and closes (MOB10)", async () => {
    const t = pair({ phoneVersion: { version: 0, min: 0 } });
    t.phone.start();
    expect(t.session.channel.verdict).toBe("update-phone");
    expect(t.session.channel.state).toBe("closed");
    t.flush();
    expect(t.phone.verdict).toBe("update-phone");
    expect(t.opened).toEqual([]);
  });
});
