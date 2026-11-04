import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptUpgrade,
  computeAcceptKey,
  createFrameParser,
  encodeClose,
  encodeFrame,
  judgeHandshake,
  WS_CLOSE,
  type WsEvent,
  type WsConnection,
} from "./ws-server";

const MASK = Buffer.from([0x12, 0x34, 0x56, 0x78]);

/** A client frame as a browser or phone would send it: masked (unless `masked: false`). */
function clientFrame(
  opcode: number,
  payload: Uint8Array,
  options: { fin?: boolean; masked?: boolean; rsv?: number } = {},
): Buffer {
  const { fin = true, masked = true, rsv = 0 } = options;
  const length = payload.length;
  const lengthBytes =
    length < 126
      ? Buffer.from([length | (masked ? 0x80 : 0)])
      : length <= 0xffff
        ? Buffer.concat([
            Buffer.from([126 | (masked ? 0x80 : 0)]),
            Buffer.from([length >> 8, length & 255]),
          ])
        : (() => {
            const big = Buffer.alloc(9);
            big[0] = 127 | (masked ? 0x80 : 0);
            big.writeBigUInt64BE(BigInt(length), 1);
            return big;
          })();
  const body = masked
    ? Buffer.from(payload).map((byte, i) => byte ^ MASK[i % 4]!)
    : Buffer.from(payload);
  return Buffer.concat([
    Buffer.from([(fin ? 0x80 : 0) | rsv | opcode]),
    lengthBytes,
    ...(masked ? [MASK] : []),
    body,
  ]);
}

describe("handshake", () => {
  it("derives the RFC 6455 example accept key", () => {
    expect(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  const good = {
    upgrade: "websocket",
    connection: "keep-alive, Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  };

  it("accepts a version 13 upgrade", () => {
    expect(judgeHandshake({ method: "GET", headers: good })).toMatchObject({ ok: true });
  });

  it("answers 426 for another version and 400 for a bad key or method", () => {
    expect(
      judgeHandshake({ method: "GET", headers: { ...good, "sec-websocket-version": "8" } }),
    ).toMatchObject({ ok: false, status: 426 });
    expect(
      judgeHandshake({ method: "GET", headers: { ...good, "sec-websocket-key": "short" } }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(judgeHandshake({ method: "POST", headers: good })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(judgeHandshake({ method: "GET", headers: { ...good, upgrade: "h2c" } })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("frame parser", () => {
  it("unmasks a binary message split across chunks", () => {
    const parser = createFrameParser(1024);
    const frame = clientFrame(0x2, Buffer.from("hello"));
    expect(parser.push(frame.subarray(0, 3))).toEqual([]);
    const events = parser.push(frame.subarray(3));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "message" });
    expect(Buffer.from((events[0] as { data: Uint8Array }).data).toString()).toBe("hello");
  });

  it("reassembles fragments, with a ping in between", () => {
    const parser = createFrameParser(1024);
    const events = parser.push(
      Buffer.concat([
        clientFrame(0x2, Buffer.from("ab"), { fin: false }),
        clientFrame(0x9, Buffer.from("p")),
        clientFrame(0x0, Buffer.from("cd")),
      ]),
    );
    expect(events.map((event) => event.kind)).toEqual(["ping", "message"]);
    expect(Buffer.from((events[1] as { data: Uint8Array }).data).toString()).toBe("abcd");
  });

  it("refuses an unmasked frame", () => {
    const events = createFrameParser(1024).push(
      clientFrame(0x2, Buffer.from("x"), { masked: false }),
    );
    expect(events).toEqual([
      { kind: "error", code: WS_CLOSE.protocolError, reason: "unmasked frame" },
    ]);
  });

  it("refuses a text frame, reserved bits and an unknown opcode", () => {
    expect(createFrameParser(1024).push(clientFrame(0x1, Buffer.from("x")))).toMatchObject([
      { kind: "error", code: WS_CLOSE.unsupportedData },
    ]);
    expect(
      createFrameParser(1024).push(clientFrame(0x2, Buffer.from("x"), { rsv: 0x40 })),
    ).toMatchObject([{ kind: "error", code: WS_CLOSE.protocolError }]);
    expect(createFrameParser(1024).push(clientFrame(0x3, Buffer.from("x")))).toMatchObject([
      { kind: "error", code: WS_CLOSE.protocolError },
    ]);
  });

  it("refuses an orphan continuation and a new message inside an unfinished one", () => {
    expect(createFrameParser(1024).push(clientFrame(0x0, Buffer.from("x")))).toMatchObject([
      { kind: "error", code: WS_CLOSE.protocolError },
    ]);
    const parser = createFrameParser(1024);
    const events = parser.push(
      Buffer.concat([
        clientFrame(0x2, Buffer.from("a"), { fin: false }),
        clientFrame(0x2, Buffer.from("b")),
      ]),
    );
    expect(events).toMatchObject([{ kind: "error", code: WS_CLOSE.protocolError }]);
  });

  it("rejects an oversized message from its header, before the payload arrives", () => {
    const parser = createFrameParser(100);
    const frame = clientFrame(0x2, Buffer.alloc(101));
    // Only the header and mask: the 101 bytes were never delivered.
    expect(parser.push(frame.subarray(0, 8))).toMatchObject([
      { kind: "error", code: WS_CLOSE.tooBig },
    ]);
  });

  it("counts earlier fragments toward the cap", () => {
    const parser = createFrameParser(100);
    const events = parser.push(
      Buffer.concat([
        clientFrame(0x2, Buffer.alloc(60), { fin: false }),
        clientFrame(0x0, Buffer.alloc(60)),
      ]),
    );
    expect(events).toMatchObject([{ kind: "error", code: WS_CLOSE.tooBig }]);
  });

  it("refuses a fragmented or oversized control frame and a 64-bit length beyond the cap", () => {
    expect(
      createFrameParser(1024).push(clientFrame(0x9, Buffer.from("x"), { fin: false })),
    ).toMatchObject([{ kind: "error", code: WS_CLOSE.protocolError }]);
    expect(createFrameParser(1024).push(clientFrame(0x9, Buffer.alloc(126)))).toMatchObject([
      { kind: "error", code: WS_CLOSE.protocolError },
    ]);
    const huge = Buffer.alloc(10);
    huge[0] = 0x82;
    huge[1] = 0x80 | 127;
    huge.writeBigUInt64BE(2n ** 40n, 2);
    expect(createFrameParser(1024).push(huge)).toMatchObject([
      { kind: "error", code: WS_CLOSE.tooBig },
    ]);
  });

  it("reports a close with its code and then ignores input", () => {
    const parser = createFrameParser(1024);
    const body = Buffer.alloc(2);
    body.writeUInt16BE(1001, 0);
    expect(parser.push(clientFrame(0x8, body))).toEqual([{ kind: "close", code: 1001 }]);
    expect(parser.push(clientFrame(0x2, Buffer.from("late")))).toEqual([]);
  });

  it("parses a frame fed one byte at a time, in linear time", () => {
    const parser = createFrameParser(200_000);
    const frame = clientFrame(0x2, Buffer.alloc(128 * 1024 - 100, 5));
    const started = performance.now();
    const events: WsEvent[] = [];
    for (let i = 0; i < frame.length; i += 1) events.push(...parser.push(frame.subarray(i, i + 1)));
    expect(events).toHaveLength(1);
    expect((events[0] as { data: Uint8Array }).data.length).toBe(128 * 1024 - 100);
    // Quadratic concatenation took seconds here; linear takes milliseconds.
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("reads 16-bit and 64-bit extended lengths", () => {
    const parser = createFrameParser(200_000);
    for (const size of [300, 70_000]) {
      const events = parser.push(clientFrame(0x2, Buffer.alloc(size, 7)));
      expect((events[0] as { data: Uint8Array }).data.length).toBe(size);
    }
  });
});

describe("server frames", () => {
  it("encodes unmasked frames with the right length forms", () => {
    expect(encodeFrame(0x2, Buffer.from("ab"))).toEqual(Buffer.from([0x82, 2, 0x61, 0x62]));
    expect(encodeFrame(0x2, Buffer.alloc(300))[1]).toBe(126);
    expect(encodeFrame(0x2, Buffer.alloc(70_000))[1]).toBe(127);
    expect(encodeClose(1000, "bye").subarray(0, 4)).toEqual(Buffer.from([0x88, 5, 0x03, 0xe8]));
  });
});

describe("a real server on loopback", () => {
  const open: { close(): void }[] = [];
  afterEach(() => {
    for (const item of open.splice(0)) item.close();
  });

  async function serve(onConnection: (connection: WsConnection) => void, max = 1024) {
    const server = http.createServer((_req, res) => res.writeHead(404).end());
    server.on("upgrade", (request, socket, head) => {
      const connection = acceptUpgrade(request, socket, head, { maxMessageBytes: max });
      if (connection !== null) onConnection(connection);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    open.push({
      close: () => {
        server.close();
        server.closeAllConnections();
      },
    });
    return (server.address() as net.AddressInfo).port;
  }

  it("echoes binary messages to Node's own WebSocket client and closes cleanly", async () => {
    const port = await serve((connection) => {
      connection.onMessage((bytes) => connection.send(Uint8Array.from(bytes).reverse()));
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    socket.binaryType = "arraybuffer";
    const got = new Promise<number[]>((resolve) => {
      socket.onmessage = (event) => resolve([...new Uint8Array(event.data as ArrayBuffer)]);
    });
    await new Promise((resolve) => (socket.onopen = resolve));
    socket.send(Uint8Array.of(1, 2, 3));
    expect(await got).toEqual([3, 2, 1]);
    const closed = new Promise<number>(
      (resolve) => (socket.onclose = (event) => resolve(event.code)),
    );
    socket.close(1000);
    expect(await closed).toBe(1000);
  });

  it("closes 1003 on a text message and 1009 on an oversized one", async () => {
    const port = await serve(() => {});
    for (const [send, code] of [
      [(socket: WebSocket) => socket.send("text"), 1003],
      [(socket: WebSocket) => socket.send(new Uint8Array(2000)), 1009],
    ] as const) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
      await new Promise((resolve) => (socket.onopen = resolve));
      const closed = new Promise<number>(
        (resolve) => (socket.onclose = (event) => resolve(event.code)),
      );
      send(socket);
      expect(await closed).toBe(code);
    }
  });

  it("closes 1002 on an unmasked frame sent by a raw client", async () => {
    const connections: WsConnection[] = [];
    const port = await serve((connection) => connections.push(connection));
    const raw = net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    raw.on("data", (chunk) => chunks.push(chunk));
    raw.write(
      [
        "GET / HTTP/1.1",
        "Host: x",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "",
        "",
      ].join("\r\n"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    raw.write(clientFrame(0x2, Buffer.from("x"), { masked: false }));
    await new Promise((resolve) => raw.on("close", resolve));
    const reply = Buffer.concat(chunks).toString("latin1");
    expect(reply).toContain("101 Switching Protocols");
    expect(reply).toContain("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    // The close frame (0x88) carries 1002.
    const index = Buffer.concat(chunks).indexOf(Buffer.from([0x88]), reply.indexOf("\r\n\r\n") + 4);
    expect(Buffer.concat(chunks).readUInt16BE(index + 2)).toBe(1002);
  });

  it("answers a bad upgrade with 426 or 400 and no socket", async () => {
    const port = await serve(() => {});
    const raw = net.connect(port, "127.0.0.1");
    let text = "";
    raw.on("data", (chunk) => (text += chunk.toString()));
    raw.write(
      "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 8\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    await new Promise((resolve) => raw.on("close", resolve));
    expect(text).toContain("426 Upgrade Required");
    expect(text).toContain("Sec-WebSocket-Version: 13");
  });
});
