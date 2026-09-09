import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpencodeClients,
  OPENCODE_CONNECT_GIVE_UP_MS,
  reserveLoopbackPort,
} from "./opencode-client";
import type { HookEventPayload } from "./hook-server";

const SES = "ses_0123456789abcdef";

/**
 * A stand-in for opencode's server: `/session/status` answers a map, `/event`
 * answers one SSE frame and then ENDS the stream, so the client's reconnect
 * path runs. Counts `/event` connections.
 */
function fakeOpencode(): Promise<{
  readonly port: number;
  readonly connections: () => number;
  close(): Promise<void>;
}> {
  let connections = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/session/status") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ [SES]: { type: "busy" } }));
      return;
    }
    if (request.url === "/event") {
      connections += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ id: "evt_1", type: "session.idle", properties: { sessionID: SES } })}\n\n`,
      );
      setTimeout(() => response.end(), 20);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        connections: () => connections,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("reserveLoopbackPort", () => {
  it("answers a usable ephemeral port", async () => {
    const port = await reserveLoopbackPort();
    expect(port).not.toBeNull();
    expect(port).toBeGreaterThan(0);
  });
});

describe("createOpencodeClients", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) {
      await close();
    }
  });

  it("forwards the catch-up status and the stream's events as server hook events", async () => {
    const server = await fakeOpencode();
    closers.push(server.close);
    const events: HookEventPayload[] = [];
    // Without the seam the client reserves a port of its own and waits for a
    // TUI that never comes; with it, it connects to the fake at once.
    const reserved = createOpencodeClients({
      emitToOwner: () => {},
      now: () => 1000,
      log: () => {},
    });
    expect(await reserved.attach(7)).toBeGreaterThan(0);
    reserved.closeAll();

    const direct = createOpencodeClients({
      emitToOwner: (_paneId, payload) => {
        events.push(payload);
      },
      now: () => 1000,
      log: () => {},
      reservePort: async () => server.port,
    });
    await direct.attach(9);
    await sleep(150);
    expect(
      events.some((event) => event.event === "session.status" && event.sessionId === SES),
    ).toBe(true);
    expect(events.some((event) => event.event === "session.idle" && event.sessionId === SES)).toBe(
      true,
    );
    expect(events.every((event) => event.source === "server" && event.agent === "opencode")).toBe(
      true,
    );
    direct.closeAll();
  });

  it("reconnects after a stream drop even past the initial connect deadline", async () => {
    const server = await fakeOpencode();
    closers.push(server.close);
    let clock = 1000;
    const clients = createOpencodeClients({
      emitToOwner: () => {},
      now: () => clock,
      log: () => {},
      reservePort: async () => server.port,
      retryMs: 30,
    });
    await clients.attach(3);
    await sleep(80);
    expect(server.connections()).toBeGreaterThanOrEqual(1);
    // A long-running pane: the first connect is far behind us when the
    // stream drops. The give-up deadline applies to the INITIAL connect only.
    clock += OPENCODE_CONNECT_GIVE_UP_MS + 10_000;
    await sleep(200);
    expect(server.connections()).toBeGreaterThanOrEqual(2);
    clients.closeAll();
  });

  it("gives up on a pane whose server never came up", async () => {
    let clock = 1000;
    const log = vi.fn();
    const clients = createOpencodeClients({
      emitToOwner: () => {},
      now: () => clock,
      log,
      // A port nothing listens on.
      reservePort: async () => 1,
      retryMs: 20,
    });
    await clients.attach(4);
    clock += OPENCODE_CONNECT_GIVE_UP_MS + 1;
    await sleep(120);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("gave up"));
    clients.closeAll();
  });
});
