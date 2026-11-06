/**
 * A minimal RFC 6455 WebSocket server endpoint for the LAN path (MOB9), on `node:http`'s `upgrade`
 * event: no dependency (F1). It does exactly what the phone link needs and refuses the rest:
 *
 * - the handshake (`Sec-WebSocket-Key` + GUID, SHA-1, version 13 only);
 * - **binary** messages, fragmented or not, reassembled up to `maxMessageBytes`;
 * - ping/pong and the close handshake.
 *
 * Text frames are refused (1003): the LAN path carries only binary peer frames, exactly like the
 * relay's peer traffic, so a text message can only be a probe or a bug, and refusing it keeps one
 * code path between the two transports. Client frames must be masked (RFC 6455 section 5.1); an
 * unmasked one is a protocol error. Extensions and subprotocols are never negotiated, so any RSV
 * bit is a protocol error.
 *
 * The size cap is enforced from the frame header, before the payload is buffered, and the running
 * message length counts the fragments already held: a socket never holds more than
 * `maxMessageBytes` of payload plus one frame header. A peer cannot grow our memory by lying about
 * a length or by never sending the final fragment.
 */
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export const WS_CLOSE = {
  normal: 1000,
  protocolError: 1002,
  unsupportedData: 1003,
  policy: 1008,
  tooBig: 1009,
  internal: 1011,
} as const;

/** The longest control-frame payload RFC 6455 allows. */
const MAX_CONTROL_BYTES = 125;
/** How long a close we started waits for the peer's answer before the socket is dropped. */
const CLOSE_LINGER_MS = 1_000;
/** Unsent bytes a slow reader may make us hold, in multiples of the message cap. */
const WRITE_BACKLOG_FACTOR = 4;

export function computeAcceptKey(key: string): string {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

/** A client key is the base64 of 16 random bytes (RFC 6455 section 4.1). */
export function isValidClientKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9+/]{22}==$/.test(key);
}

export type HandshakeVerdict =
  | { readonly ok: true; readonly acceptKey: string }
  | { readonly ok: false; readonly status: 400 | 426; readonly reason: string };

/** Judges an upgrade request. Pure, so the refusals are testable without a socket. */
export function judgeHandshake(request: {
  readonly method?: string;
  readonly headers: IncomingMessage["headers"];
}): HandshakeVerdict {
  const { headers } = request;
  if (request.method !== "GET") return { ok: false, status: 400, reason: "method" };
  if (String(headers.upgrade ?? "").toLowerCase() !== "websocket") {
    return { ok: false, status: 400, reason: "upgrade" };
  }
  const connection = String(headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((token) => token.trim());
  if (!connection.includes("upgrade")) return { ok: false, status: 400, reason: "connection" };
  if (headers["sec-websocket-version"] !== "13") {
    return { ok: false, status: 426, reason: "version" };
  }
  const key = headers["sec-websocket-key"];
  if (!isValidClientKey(key)) return { ok: false, status: 400, reason: "key" };
  return { ok: true, acceptKey: computeAcceptKey(key) };
}

// --- frames --------------------------------------------------------------------------------

export function encodeFrame(opcode: number, payload: Uint8Array): Buffer {
  const length = payload.byteLength;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode; // FIN set: this server never fragments what it sends
  return Buffer.concat([header, payload]);
}

export function encodeClose(code: number, reason = ""): Buffer {
  const text = Buffer.from(reason, "utf8").subarray(0, MAX_CONTROL_BYTES - 2);
  const body = Buffer.alloc(2 + text.length);
  body.writeUInt16BE(code, 0);
  text.copy(body, 2);
  return encodeFrame(OP_CLOSE, body);
}

export type WsEvent =
  | { readonly kind: "message"; readonly data: Uint8Array }
  | { readonly kind: "ping"; readonly data: Uint8Array }
  | { readonly kind: "pong" }
  | { readonly kind: "close"; readonly code: number | null }
  | { readonly kind: "error"; readonly code: number; readonly reason: string };

export interface FrameParser {
  /** Feed bytes as they arrive; returns the events they completed, in order. Never throws. */
  push(chunk: Uint8Array): WsEvent[];
}

/**
 * Incremental client-frame parser. After the first `error` or `close` event it ignores all input.
 */
export function createFrameParser(maxMessageBytes: number): FrameParser {
  // Received bytes as a list with a running length: a byte-at-a-time peer costs O(1) per read,
  // and bytes are joined only when a whole frame is present.
  let chunks: Buffer[] = [];
  let size = 0;
  const fragments: Buffer[] = [];
  let assembled = 0;
  let inMessage = false;
  let dead = false;

  /** Copies the first `count` buffered bytes (at most the buffered amount) without consuming them. */
  function peek(count: number): Buffer {
    const out = Buffer.allocUnsafe(Math.min(count, size));
    let at = 0;
    for (const part of chunks) {
      if (at >= out.length) break;
      at += part.copy(out, at, 0, out.length - at);
    }
    return out;
  }

  /** Removes and returns the first `count` buffered bytes. */
  function take(count: number): Buffer {
    const out = peek(count);
    let left = count;
    let used = 0;
    while (left > 0) {
      const part = chunks[used]!;
      if (part.length <= left) {
        left -= part.length;
        used += 1;
      } else {
        chunks[used] = part.subarray(left);
        left = 0;
      }
    }
    // One splice for the consumed parts, not a shift per part.
    chunks = used === 0 ? chunks : chunks.slice(used);
    size -= count;
    return out;
  }

  function fail(events: WsEvent[], code: number, reason: string): void {
    dead = true;
    chunks = [];
    size = 0;
    fragments.length = 0;
    events.push({ kind: "error", code, reason });
  }

  return {
    push(chunk) {
      const events: WsEvent[] = [];
      if (dead) return events;
      if (chunk.length > 0) {
        chunks.push(Buffer.from(chunk));
        size += chunk.length;
      }
      for (;;) {
        if (size < 2) return events;
        const pending = peek(14);
        const first = pending[0]!;
        const second = pending[1]!;
        const fin = (first & 0x80) !== 0;
        const opcode = first & 0x0f;
        if ((first & 0x70) !== 0) {
          fail(events, WS_CLOSE.protocolError, "reserved bits");
          return events;
        }
        if ((second & 0x80) === 0) {
          fail(events, WS_CLOSE.protocolError, "unmasked frame");
          return events;
        }
        const isControl = (opcode & 0x8) !== 0;
        let length = second & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (size < 4) return events;
          length = pending.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (size < 10) return events;
          const wide = pending.readBigUInt64BE(2);
          if (wide > BigInt(maxMessageBytes)) {
            fail(events, WS_CLOSE.tooBig, "message too big");
            return events;
          }
          length = Number(wide);
          offset = 10;
        }
        if (isControl && (!fin || length > MAX_CONTROL_BYTES)) {
          fail(events, WS_CLOSE.protocolError, "bad control frame");
          return events;
        }
        if (!isControl) {
          // The cap is checked on the header, before the payload is held.
          if (assembled + length > maxMessageBytes) {
            fail(events, WS_CLOSE.tooBig, "message too big");
            return events;
          }
          if (opcode === OP_TEXT) {
            fail(events, WS_CLOSE.unsupportedData, "text frames are not accepted");
            return events;
          }
          if (opcode === OP_CONTINUATION ? !inMessage : opcode !== OP_BINARY || inMessage) {
            fail(events, WS_CLOSE.protocolError, "bad fragment order");
            return events;
          }
        } else if (opcode !== OP_CLOSE && opcode !== OP_PING && opcode !== OP_PONG) {
          fail(events, WS_CLOSE.protocolError, "unknown opcode");
          return events;
        }
        const total = offset + 4 + length;
        if (size < total) return events;
        const frame = take(total);
        const mask = frame.subarray(offset, offset + 4);
        const payload = frame.subarray(offset + 4, total);
        for (let i = 0; i < payload.length; i += 1) payload[i] = payload[i]! ^ mask[i % 4]!;

        if (isControl) {
          if (opcode === OP_PING) events.push({ kind: "ping", data: payload });
          else if (opcode === OP_PONG) events.push({ kind: "pong" });
          else {
            if (payload.length === 1) {
              fail(events, WS_CLOSE.protocolError, "bad close payload");
              return events;
            }
            // The close reason is not validated as UTF-8: it is never read, only echoed away.
            dead = true;
            events.push({
              kind: "close",
              code: payload.length >= 2 ? payload.readUInt16BE(0) : null,
            });
            return events;
          }
          continue;
        }
        fragments.push(payload);
        assembled += length;
        inMessage = !fin;
        if (fin) {
          events.push({ kind: "message", data: Buffer.concat(fragments, assembled) });
          fragments.length = 0;
          assembled = 0;
        }
      }
    },
  };
}

// --- the connection ------------------------------------------------------------------------

export interface WsConnection {
  /** Sends one binary message; false when the socket is not open. */
  send(bytes: Uint8Array): boolean;
  /** Starts the close handshake; the socket is dropped if the peer does not answer. */
  close(code?: number, reason?: string): void;
  /** Whether the socket can still carry messages. */
  readonly open: boolean;
  readonly remoteAddress: string | undefined;
  onMessage(listener: (bytes: Uint8Array) => void): void;
  /** Fires once, whatever ended the connection. */
  onClose(listener: (code: number | null) => void): void;
}

/** Answers a refused upgrade with a plain HTTP status and drops the socket. */
export function refuseUpgrade(socket: Duplex, status: number, extraHeaders: string[] = []): void {
  const label =
    { 400: "Bad Request", 404: "Not Found", 426: "Upgrade Required", 503: "Service Unavailable" }[
      status
    ] ?? "Error";
  socket.end(
    [
      `HTTP/1.1 ${status} ${label}`,
      "Connection: close",
      "Content-Length: 0",
      ...extraHeaders,
      "",
      "",
    ].join("\r\n"),
  );
  setTimeout(() => socket.destroy(), CLOSE_LINGER_MS).unref();
}

/**
 * Completes the handshake on an `upgrade` socket and returns the connection, or answers 400/426
 * and returns null. `head` is whatever the client sent after its headers.
 */
export function acceptUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: { readonly maxMessageBytes: number },
): WsConnection | null {
  const verdict = judgeHandshake(request);
  if (!verdict.ok) {
    refuseUpgrade(
      socket,
      verdict.status,
      verdict.status === 426 ? ["Sec-WebSocket-Version: 13"] : [],
    );
    return null;
  }
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${verdict.acceptKey}`,
      "",
      "",
    ].join("\r\n"),
  );

  const parser = createFrameParser(options.maxMessageBytes);
  const messageListeners: ((bytes: Uint8Array) => void)[] = [];
  const closeListeners: ((code: number | null) => void)[] = [];
  let state: "open" | "closing" | "closed" = "open";
  let lingerTimer: NodeJS.Timeout | null = null;
  let closeCode: number | null = null;

  function finish(code: number | null): void {
    if (state === "closed") return;
    state = "closed";
    if (lingerTimer !== null) clearTimeout(lingerTimer);
    closeCode = code;
    socket.destroy();
    for (const listener of closeListeners) listener(closeCode);
  }

  function startClose(code: number, reason: string): void {
    if (state !== "open") return;
    state = "closing";
    socket.write(encodeClose(code, reason));
    // Stop reading application data now; only the peer's close (or the timer) ends the socket.
    lingerTimer = setTimeout(() => finish(code), CLOSE_LINGER_MS);
    lingerTimer.unref();
  }

  function onEvents(events: WsEvent[]): void {
    for (const event of events) {
      if (state === "closed") return;
      switch (event.kind) {
        case "message":
          if (state === "open") for (const listener of messageListeners) listener(event.data);
          break;
        case "ping":
          if (state === "open") socket.write(encodeFrame(OP_PONG, event.data));
          break;
        case "pong":
          break;
        case "close":
          // Answer a peer-initiated close once, then we are done; if we started it, this is the answer.
          if (state === "open") socket.write(encodeClose(event.code ?? WS_CLOSE.normal));
          finish(event.code ?? WS_CLOSE.normal);
          return;
        case "error":
          startClose(event.code, event.reason);
          return;
      }
    }
  }

  socket.on("data", (chunk: Buffer) => {
    onEvents(parser.push(chunk));
    // A reader too slow for what we send would otherwise make us buffer without limit.
    if (
      state !== "closed" &&
      socket.writableLength > options.maxMessageBytes * WRITE_BACKLOG_FACTOR
    ) {
      finish(WS_CLOSE.policy);
    }
  });
  socket.on("close", () => finish(closeCode ?? 1006));
  socket.on("error", () => finish(1006));
  (socket as Partial<Socket>).setNoDelay?.(true);
  if (head.length > 0) queueMicrotask(() => onEvents(parser.push(head)));

  return {
    get open() {
      return state === "open";
    },
    get remoteAddress() {
      return (socket as { remoteAddress?: string }).remoteAddress;
    },
    send(bytes) {
      if (state !== "open") return false;
      if (socket.writableLength > options.maxMessageBytes * WRITE_BACKLOG_FACTOR) {
        finish(WS_CLOSE.policy);
        return false;
      }
      socket.write(encodeFrame(OP_BINARY, bytes));
      return true;
    },
    close(code = WS_CLOSE.normal, reason = "") {
      startClose(code, reason);
    },
    onMessage: (listener) => void messageListeners.push(listener),
    onClose: (listener) => void closeListeners.push(listener),
  };
}
