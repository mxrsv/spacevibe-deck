import { DurableObject } from "cloudflare:workers";
import {
  MAX_PUSH_BYTES,
  RELAY_AUTH_TIMEOUT_MS,
  RELAY_MAX_FRAME_BYTES,
  RELAY_MAX_SOCKETS_PER_ROLE,
  RELAY_PUSH_RATE,
  RELAY_RATE,
} from "../../protocol/src/limits";
import {
  RELAY_CLOSE,
  parseClientToRelay,
  parsePairingRegistration,
  type ClientToRelay,
  type PushEnv,
  type PushKind,
  type RelayErrorCode,
  type RelayRole,
  type RelayToClient,
} from "../../protocol/src/relay-messages";
import type { Env } from "./env";
import { logEvent } from "./log";
import { sendPush } from "./push";
import { takeFromBucket, takeFromWindow, type Bucket, type Window } from "./rate-limit";
import { constantTimeEqual, hashToken } from "./token-hash";

/**
 * The whole of what the relay keeps about a pairing (spec MOB6). Nothing in a frame, a push body,
 * a client address or a request header is ever added to it.
 */
export interface PairingRecord {
  readonly pairingId: string;
  readonly desktopTokenHash: string;
  readonly phoneTokenHash: string | null;
  readonly claimHash: string | null;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly desktopLastSeen: number | null;
  readonly phoneLastSeen: number | null;
  readonly push: { readonly kind: PushKind; readonly token: string; readonly env: PushEnv } | null;
}

/** Survives hibernation with the socket; `role` is null until the socket authenticates. */
interface Attachment {
  readonly role: RelayRole | null;
  readonly authed: boolean;
  readonly connectedAt: number;
}

const STORAGE_KEY = "pairing";
const OPEN = 1;

function otherRole(role: RelayRole): RelayRole {
  return role === "desktop" ? "phone" : "desktop";
}

function lastSeenKey(role: RelayRole): "desktopLastSeen" | "phoneLastSeen" {
  return role === "desktop" ? "desktopLastSeen" : "phoneLastSeen";
}

function parseAttachment(value: unknown): Attachment {
  const v = (value ?? {}) as Partial<Attachment>;
  return {
    role: v.role === "desktop" || v.role === "phone" ? v.role : null,
    authed: v.authed === true,
    connectedAt: typeof v.connectedAt === "number" ? v.connectedAt : 0,
  };
}

/**
 * One desktop-phone pairing. It holds the pairing record, pairs the two sockets and forwards
 * their binary frames without looking inside. It uses the WebSocket Hibernation API, so an idle
 * pairing costs no duration (MOB6): everything a wake-up needs is in storage or in an attachment,
 * and the only state kept in memory (rate buckets, the push window) is allowed to reset.
 */
export class PairingRoom extends DurableObject<Env> {
  private pairing: PairingRecord | null = null;
  private readonly buckets = new WeakMap<WebSocket, Bucket>();
  private readonly handshaking = new WeakSet<WebSocket>();
  private pushWindow: Window = { start: 0, count: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.pairing = (await ctx.storage.get<PairingRecord>(STORAGE_KEY)) ?? null;
    });
    // Answered by the runtime without waking the object, so keep-alives are free.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/register" && request.method === "POST") {
      return this.register(await request.json().catch(() => null));
    }
    if (pathname === "/socket") return this.acceptSocket();
    return new Response(null, { status: 404 });
  }

  // --- registration and sockets ---------------------------------------------------------------

  private async register(body: unknown): Promise<Response> {
    const registration = parsePairingRegistration(body);
    if (registration === null) return Response.json({ error: "invalid" }, { status: 400 });
    if (this.pairing !== null) return Response.json({ error: "exists" }, { status: 409 });
    this.pairing = {
      pairingId: registration.pairingId,
      desktopTokenHash: registration.desktopTokenHash,
      phoneTokenHash: null,
      claimHash: registration.claimHash,
      expiresAt: registration.expiresAt,
      createdAt: Date.now(),
      desktopLastSeen: null,
      phoneLastSeen: null,
      push: null,
    };
    await this.persist();
    await this.reschedule();
    logEvent("registered");
    return Response.json({ ok: true }, { status: 201 });
  }

  private async acceptSocket(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    if (this.pairing === null) {
      // Nothing to keep alive: a plain socket tells the client and closes, with no hibernation
      // bookkeeping and no alarm.
      server.accept();
      this.fail(server, "unknown");
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { role: null, authed: false, connectedAt: Date.now() };
    server.serializeAttachment(attachment);
    await this.reschedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = parseAttachment(ws.deserializeAttachment());
    const taken = takeFromBucket(this.buckets.get(ws), Date.now(), RELAY_RATE);
    this.buckets.set(ws, taken.bucket);
    if (!taken.allowed) return this.fail(ws, "rate-limited");
    const size =
      typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    if (size > RELAY_MAX_FRAME_BYTES) return this.fail(ws, "too-large");
    if (this.pairing === null) return this.fail(ws, "unknown");

    if (typeof message !== "string") {
      if (!attachment.authed || attachment.role === null) return this.fail(ws, "unauthorized");
      return this.forward(ws, attachment.role, message);
    }
    const parsed = parseClientToRelay(message, MAX_PUSH_BYTES);
    if (parsed === null) {
      logEvent("bad-message");
      // Before authentication a malformed message is hostile; afterwards it may be a newer dialect.
      if (!attachment.authed) this.fail(ws, "unauthorized");
      return;
    }
    if (parsed.t === "ping") return this.send(ws, { t: "pong" });
    if (!attachment.authed || attachment.role === null) return this.handshake(ws, parsed);
    return this.control(attachment.role, parsed);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    logEvent("socket-error");
    await this.socketGone(ws);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const pairing = this.pairing;
    if (pairing !== null && pairing.phoneTokenHash === null && now >= pairing.expiresAt) {
      await this.destroy("expired");
      return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      const { authed, connectedAt } = parseAttachment(ws.deserializeAttachment());
      if (!authed && now - connectedAt >= RELAY_AUTH_TIMEOUT_MS) this.fail(ws, "auth-timeout");
    }
    await this.reschedule();
  }

  // --- authentication --------------------------------------------------------------------------

  private async handshake(ws: WebSocket, message: ClientToRelay): Promise<void> {
    if (message.t !== "auth" && message.t !== "claim") return this.fail(ws, "unauthorized");
    // A second handshake message while the first is still being hashed would race it.
    if (this.handshaking.has(ws)) return this.fail(ws, "unauthorized");
    this.handshaking.add(ws);
    try {
      if (message.t === "auth") await this.authenticate(ws, message.role, message.token);
      else await this.claim(ws, message.claimToken, message.phoneTokenHash);
    } finally {
      this.handshaking.delete(ws);
    }
  }

  private async authenticate(ws: WebSocket, role: RelayRole, token: string): Promise<void> {
    const presented = await hashToken(token);
    const pairing = this.pairing;
    if (pairing === null || ws.readyState !== OPEN) return;
    const expected = role === "desktop" ? pairing.desktopTokenHash : pairing.phoneTokenHash;
    if (expected === null || !constantTimeEqual(presented, expected)) {
      return this.fail(ws, "unauthorized");
    }
    await this.admit(ws, role);
  }

  private async claim(ws: WebSocket, claimToken: string, phoneTokenHash: string): Promise<void> {
    const presented = await hashToken(claimToken);
    const pairing = this.pairing;
    if (pairing === null || ws.readyState !== OPEN) return;
    if (pairing.phoneTokenHash !== null || pairing.claimHash === null) {
      return this.fail(ws, "claimed");
    }
    if (Date.now() >= pairing.expiresAt) return this.destroy("expired");
    if (!constantTimeEqual(presented, pairing.claimHash)) return this.fail(ws, "unauthorized");
    // Committed in memory before any further await, so two racing claims cannot both pass the check.
    this.pairing = { ...pairing, phoneTokenHash, claimHash: null };
    logEvent("claimed");
    await this.admit(ws, "phone");
  }

  /** Makes an authenticated socket live: evicts surplus ones, announces it, records the visit. */
  private async admit(ws: WebSocket, role: RelayRole): Promise<void> {
    const { connectedAt } = parseAttachment(ws.deserializeAttachment());
    const previous = this.authedSockets(role, ws).sort(
      (a, b) =>
        parseAttachment(a.deserializeAttachment()).connectedAt -
        parseAttachment(b.deserializeAttachment()).connectedAt,
    );
    // The newcomer counts as one of the allowed sockets; the oldest of the rest make room.
    for (const old of previous.slice(
      0,
      Math.max(0, previous.length - (RELAY_MAX_SOCKETS_PER_ROLE - 1)),
    )) {
      this.fail(old, "too-many-sockets");
    }
    const attachment: Attachment = { role, authed: true, connectedAt };
    ws.serializeAttachment(attachment);

    const now = Date.now();
    const pairing = this.pairing;
    if (pairing === null) return;
    this.pairing = { ...pairing, [lastSeenKey(role)]: now };
    const peer = otherRole(role);
    this.send(ws, {
      t: "ready",
      role,
      peerOnline: this.authedSockets(peer).length > 0,
      peerLastSeen: pairing[lastSeenKey(peer)],
    });
    if (previous.length === 0) this.notify(peer, { t: "peer", online: true, lastSeen: now });
    logEvent("auth");
    await this.persist();
    await this.reschedule();
  }

  // --- authenticated traffic -------------------------------------------------------------------

  private forward(ws: WebSocket, role: RelayRole, frame: ArrayBuffer): void {
    const peers = this.authedSockets(otherRole(role), ws);
    if (peers.length === 0) return logEvent("dropped-no-peer");
    for (const peer of peers) {
      try {
        peer.send(frame);
      } catch {
        // A peer that just closed is handled by its own close event.
      }
    }
    logEvent("forwarded", peers.length);
  }

  private async control(role: RelayRole, message: ClientToRelay): Promise<void> {
    const pairing = this.pairing;
    if (pairing === null) return;
    switch (message.t) {
      case "revoke":
        return this.destroy("revoked");
      case "push-token": {
        if (role !== "phone") return logEvent("ignored-message");
        const { kind, token, env } = message;
        const same =
          pairing.push?.kind === kind && pairing.push.token === token && pairing.push.env === env;
        if (same) return;
        this.pairing = { ...pairing, push: { kind, token, env } };
        return this.persist();
      }
      case "push":
        if (role !== "desktop") return logEvent("ignored-message");
        return this.push(pairing, message.data);
      default:
        return logEvent("ignored-message");
    }
  }

  private async push(pairing: PairingRecord, data: string): Promise<void> {
    const taken = takeFromWindow(this.pushWindow, Date.now(), RELAY_PUSH_RATE);
    this.pushWindow = taken.window;
    // Over the limit a push is dropped, not an error: closing the desktop would cost its session.
    if (!taken.allowed) return logEvent("push-rate-limited");
    if (pairing.push === null) return logEvent("push-no-token");
    const outcome = await sendPush(this.env, pairing.push, pairing.pairingId, data);
    logEvent(`push-${outcome}`);
    const current = this.pairing;
    if (outcome === "unregistered" && current?.push?.token === pairing.push.token) {
      this.pairing = { ...current, push: null };
      await this.persist();
    }
  }

  // --- teardown --------------------------------------------------------------------------------

  private async socketGone(ws: WebSocket): Promise<void> {
    const { authed, role } = parseAttachment(ws.deserializeAttachment());
    const pairing = this.pairing;
    if (pairing === null) return;
    if (!authed || role === null) return this.reschedule();
    if (this.authedSockets(role, ws).length > 0) return;
    const now = Date.now();
    this.pairing = { ...pairing, [lastSeenKey(role)]: now };
    this.notify(otherRole(role), { t: "peer", online: false, lastSeen: now });
    await this.persist();
  }

  /** Deletes the pairing for good and tells every socket why. Later connects get `unknown`. */
  private async destroy(reason: "revoked" | "expired"): Promise<void> {
    this.pairing = null;
    for (const ws of this.ctx.getWebSockets()) {
      const { authed } = parseAttachment(ws.deserializeAttachment());
      if (reason === "expired") this.fail(ws, "expired");
      else if (authed) this.closeRevoked(ws);
      else this.fail(ws, "unknown");
    }
    logEvent(reason);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private closeRevoked(ws: WebSocket): void {
    this.send(ws, { t: "revoked" });
    try {
      ws.close(RELAY_CLOSE.revoked, "revoked");
    } catch {
      // Already closed.
    }
  }

  // --- helpers ---------------------------------------------------------------------------------

  private authedSockets(role: RelayRole, except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws === except || ws.readyState !== OPEN) return false;
      const attachment = parseAttachment(ws.deserializeAttachment());
      return attachment.authed && attachment.role === role;
    });
  }

  private notify(role: RelayRole, message: RelayToClient): void {
    for (const ws of this.authedSockets(role)) this.send(ws, message);
  }

  private send(ws: WebSocket, message: RelayToClient): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket closed under us; its close event cleans up.
    }
  }

  private fail(ws: WebSocket, code: RelayErrorCode): void {
    this.send(ws, { t: "error", code });
    try {
      ws.close(RELAY_CLOSE[code], code);
    } catch {
      // Already closed.
    }
    logEvent("close", RELAY_CLOSE[code]);
  }

  private async persist(): Promise<void> {
    if (this.pairing !== null) await this.ctx.storage.put(STORAGE_KEY, this.pairing);
  }

  /** One alarm serves two deadlines: the unclaimed pairing's expiry and unauthenticated sockets. */
  private async reschedule(): Promise<void> {
    const deadlines: number[] = [];
    const pairing = this.pairing;
    if (pairing !== null && pairing.phoneTokenHash === null) deadlines.push(pairing.expiresAt);
    for (const ws of this.ctx.getWebSockets()) {
      const { authed, connectedAt } = parseAttachment(ws.deserializeAttachment());
      if (!authed && ws.readyState === OPEN) deadlines.push(connectedAt + RELAY_AUTH_TIMEOUT_MS);
    }
    const current = await this.ctx.storage.getAlarm();
    if (deadlines.length === 0) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    const next = Math.min(...deadlines);
    if (current !== next) await this.ctx.storage.setAlarm(next);
  }
}
