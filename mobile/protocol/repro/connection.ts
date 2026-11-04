/**
 * One authenticated relay socket carrying a secure channel, with request/response on top. This is
 * the same path the phone app takes: relay control JSON as text, everything else as binary frames.
 */
import { createPhoneChannel, type PhoneChannel } from "../src/channel";
import { createChunkAssembler } from "../src/chunk";
import { createNodeCrypto } from "../src/crypto-node";
import { b64urlDecode } from "../src/encoding";
import { PROTOCOL_VERSION } from "../src/version";
import { parseAppMessage, type AppEvent, type MethodParams, type Method } from "../src/messages";
import {
  pairingSocketUrl,
  parseRelayToClient,
  RELAY_ERROR_TEXT,
  type ClientToRelay,
  type RelayToClient,
} from "../src/relay-messages";
import type { JsonObject } from "../src/validate";
import type { ReproPairing } from "./store";

export const crypto = createNodeCrypto();
const STEP_TIMEOUT_MS = 15_000;

/** A queue of inbound items that a caller can wait on with a predicate and a deadline. */
export function createInbox<T>() {
  const items: T[] = [];
  const waiters: { match: (item: T) => boolean; resolve: (item: T) => void }[] = [];
  return {
    push(item: T) {
      const index = waiters.findIndex((waiter) => waiter.match(item));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(item);
      else items.push(item);
    },
    next(match: (item: T) => boolean, what: string, ms = STEP_TIMEOUT_MS): Promise<T> {
      const index = items.findIndex(match);
      if (index >= 0) return Promise.resolve(items.splice(index, 1)[0]);
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), ms);
        waiters.push({
          match,
          resolve: (item) => {
            clearTimeout(timer);
            resolve(item);
          },
        });
      });
    },
  };
}

export interface RelaySocket {
  readonly ws: WebSocket;
  readonly control: ReturnType<typeof createInbox<RelayToClient>>;
  readonly binary: ReturnType<typeof createInbox<Uint8Array>>;
  /** Set once the relay or the network closed the socket. */
  closed: { code: number } | null;
  sendControl(message: ClientToRelay): void;
}

export function openRelaySocket(
  pairing: Pick<ReproPairing, "relayUrl" | "pairingId">,
  onBinary?: (frame: Uint8Array) => void,
): Promise<RelaySocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(pairingSocketUrl(pairing.relayUrl, pairing.pairingId));
    ws.binaryType = "arraybuffer";
    const control = createInbox<RelayToClient>();
    const binary = createInbox<Uint8Array>();
    const socket: RelaySocket = {
      ws,
      control,
      binary,
      closed: null,
      sendControl: (message) => ws.send(JSON.stringify(message)),
    };
    const timer = setTimeout(
      () => reject(new Error("Timed out connecting to the relay")),
      STEP_TIMEOUT_MS,
    );
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(
        new Error(`Could not connect to ${pairingSocketUrl(pairing.relayUrl, pairing.pairingId)}`),
      );
    });
    ws.addEventListener("close", (event) => {
      socket.closed = { code: event.code };
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const message = parseRelayToClient(event.data);
        if (message !== null) control.push(message);
      } else if (event.data instanceof ArrayBuffer) {
        const frame = new Uint8Array(event.data);
        if (onBinary !== undefined) onBinary(frame);
        else binary.push(frame);
      }
    });
  });
}

/** Turns a relay `error` message into the sentence the phone would show. */
export function relayErrorText(message: RelayToClient): string | null {
  return message.t === "error" ? RELAY_ERROR_TEXT[message.code] : null;
}

async function expectReady(socket: RelaySocket): Promise<Extract<RelayToClient, { t: "ready" }>> {
  const message = await socket.control.next(
    (item) => item.t === "ready" || item.t === "error" || item.t === "revoked",
    "the relay's ready message",
  );
  if (message.t === "ready") return message;
  throw new Error(relayErrorText(message) ?? "This pairing was revoked.");
}

export interface Connection {
  readonly channel: PhoneChannel;
  readonly socket: RelaySocket;
  /** Sends a request and resolves with its `r` (chunked bodies joined into `body`). */
  request<M extends Method>(
    method: M,
    params: MethodParams[M],
  ): Promise<{ readonly r: JsonObject; readonly body: string | null }>;
  onEvent(listener: (event: AppEvent) => void): void;
  close(): void;
}

export async function connect(pairing: ReproPairing): Promise<Connection> {
  const states = createInbox<string>();
  let channel!: PhoneChannel;
  const socket = await openRelaySocket(pairing, (frame) => channel.receive(frame));
  socket.sendControl({ t: "auth", role: "phone", token: pairing.phoneToken });
  const ready = await expectReady(socket);
  if (!ready.peerOnline) {
    console.error("The desktop is offline; waiting for it to connect...");
    await socket.control.next(
      (item) => item.t === "peer" && item.online,
      "the desktop to come online",
      60_000,
    );
  }

  channel = createPhoneChannel({
    crypto,
    pairing: { pairingId: pairing.pairingId, pairKey: b64urlDecode(pairing.pairKey) },
    send: (frame) => socket.ws.send(frame),
    session: { device: "deck-repro", appVersion: `repro-${PROTOCOL_VERSION}` },
  });
  channel.onState((state, reason) => states.push(`${state}:${reason ?? ""}`));

  const pending = new Map<number, (message: { r?: JsonObject; error?: string }) => void>();
  const assembler = createChunkAssembler();
  const assembled = createInbox<{ id: string; text: string }>();
  const listeners: ((event: AppEvent) => void)[] = [];
  let nextId = 1;

  channel.onMessage((raw) => {
    const message = parseAppMessage(raw);
    if (message === null) return;
    if (message.kind === "response") {
      const resolve = pending.get(message.response.id);
      pending.delete(message.response.id);
      if (message.response.ok) resolve?.({ r: message.response.r });
      else resolve?.({ error: `${message.response.e.code}: ${message.response.e.message}` });
    } else if (message.kind === "event") {
      if (message.event.ev === "chunk") {
        const step = assembler.push(message.event.p);
        if (step.status === "done") assembled.push({ id: step.id, text: step.text });
      }
      for (const listener of listeners) listener(message.event);
    }
  });

  channel.start();
  const outcome = await states.next(
    (item) => item.startsWith("open") || item.startsWith("closed"),
    "the secure channel",
    10_000,
  );
  if (outcome.startsWith("closed")) {
    const reason = outcome.slice("closed:".length);
    throw new Error(
      reason === "update-phone" || reason === "update-desktop"
        ? `Protocol version mismatch: ${reason}.`
        : `The channel closed during the handshake (${reason}).`,
    );
  }

  return {
    channel,
    socket,
    onEvent: (listener) => void listeners.push(listener),
    close: () => socket.ws.close(1000),
    async request(method, params) {
      const id = nextId++;
      const answer = new Promise<{ r?: JsonObject; error?: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} timed out`)), STEP_TIMEOUT_MS);
        pending.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      const sent = channel.sendMessage({ id, m: method, p: params });
      if (sent !== "sent") throw new Error(`Could not send ${method}: ${sent}`);
      const result = await answer;
      if (result.r === undefined) throw new Error(result.error ?? `${method} failed`);
      const chunkedId = typeof result.r.chunked === "string" ? result.r.chunked : null;
      const body =
        chunkedId === null
          ? null
          : (await assembled.next((item) => item.id === chunkedId, "the chunked body")).text;
      return { r: result.r, body };
    },
  };
}
