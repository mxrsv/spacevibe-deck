import { createPhoneChannel, type PhoneChannel } from "@protocol/channel";
import type { CryptoProvider } from "@protocol/crypto";
import { parseAppMessage, type AppEvent, type LanAddress } from "@protocol/messages";
import { RELAY_ERROR_TEXT, type ClientToRelay } from "@protocol/relay-messages";
import { backoffDelay } from "./backoff";
import type { Link, LinkDown, LinkFactory, LinkKind } from "./relay-link";
import { createRpc, type RpcClient } from "./rpc";

/** The desktop must answer `session.start` within this, or the attempt counts as failed. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

export type ConnectionStatus =
  | "connecting"
  | "online"
  | "offline" // the relay is reachable, the desktop is not (MOB11)
  | "blocked" // protocol versions do not overlap (MOB10)
  | "revoked" // the desktop removed this phone (MOB2)
  | "failed"; // the relay refused or cannot be reached
export type VersionBlock = "update-phone" | "update-desktop";

export interface DesktopLive {
  readonly name: string;
  readonly os: "macos" | "windows" | "linux";
  readonly appVersion: string;
  readonly protocol: number;
  readonly lan: readonly LanAddress[];
}

export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  /** The path in use: the relay today, `lan` once T10 adds it. Null while not connected. */
  readonly path: LinkKind | null;
  /** The relay's last-seen time for the desktop, in ms since the epoch. */
  readonly lastSeen: number | null;
  readonly block: VersionBlock | null;
  /** A sentence the user can act on (MOB8), or null. */
  readonly problem: string | null;
  /** What the desktop reported about itself in this session, null until it does. */
  readonly live: DesktopLive | null;
}

export interface DesktopConnection {
  getSnapshot(): ConnectionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Desktop events (`tree`, `term.data`, ...) once the session is open. */
  onEvent(listener: (event: AppEvent) => void): () => void;
  readonly rpc: RpcClient;
  /** Sends a relay control message on the current link; false when no relay link is up. */
  sendControl(message: ClientToRelay): boolean;
  start(): void;
  stop(): void;
  /** Drop whatever state the connection is in and try now (pull to refresh, a tap on "Retry"). */
  retryNow(): void;
}

export interface ConnectionDeps {
  readonly pairing: { readonly pairingId: string; readonly pairKey: Uint8Array };
  readonly crypto: CryptoProvider;
  readonly openLink: LinkFactory;
  readonly session: { readonly device: string; readonly appVersion: string };
  readonly random?: () => number;
  /**
   * Paths to try, best first. T10 returns `["lan", "relay"]` once the desktop has offered a LAN
   * address; a LAN failure falls through to the relay without waiting.
   */
  readonly linkOrder?: (live: DesktopLive | null) => readonly LinkKind[];
}

const INITIAL: ConnectionSnapshot = {
  status: "connecting",
  path: null,
  lastSeen: null,
  block: null,
  problem: null,
  live: null,
};

/** Failures in a row before "connecting" turns into a visible problem. */
const QUIET_FAILURES = 2;

/** Relay errors a retry cannot fix: the user has to act. */
const TERMINAL_RELAY_ERRORS = new Set([
  "unauthorized",
  "unknown",
  "too-many-sockets",
  "claimed",
  "expired",
]);

export function createDesktopConnection(deps: ConnectionDeps): DesktopConnection {
  const random = deps.random ?? Math.random;
  const order = deps.linkOrder ?? (() => ["relay"] as const);
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: AppEvent) => void>();

  let snapshot: ConnectionSnapshot = INITIAL;
  let running = false;
  let generation = 0; // a callback from a replaced link carries an old number and is dropped
  let link: Link | null = null;
  let channel: PhoneChannel | null = null;
  let kindIndex = 0;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  const rpc = createRpc((message) => channel?.sendMessage(message) ?? "not-open");

  function set(patch: Partial<ConnectionSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function clearTimers(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (handshakeTimer !== null) clearTimeout(handshakeTimer);
    retryTimer = null;
    handshakeTimer = null;
  }

  function dropChannel(reason: string): void {
    if (handshakeTimer !== null) clearTimeout(handshakeTimer);
    handshakeTimer = null;
    const old = channel;
    channel = null; // before close, so the channel's own state callback is ignored
    old?.close(reason);
    rpc.failAll("closed", "Disconnected from this desktop.");
  }

  function dropLink(): void {
    generation++;
    link?.close();
    link = null;
  }

  function scheduleRetry(): void {
    if (!running) return;
    const kinds = order(snapshot.live);
    if (kindIndex + 1 < kinds.length) {
      kindIndex++;
      attempt();
      return;
    }
    kindIndex = 0;
    const delay = backoffDelay(failures, random);
    failures++;
    retryTimer = setTimeout(attempt, delay);
  }

  function beginChannel(): void {
    if (link === null) return;
    dropChannel("restart");
    const current = link;
    const next = createPhoneChannel({
      crypto: deps.crypto,
      pairing: deps.pairing,
      send: (frame) => current.send(frame),
      session: deps.session,
    });
    channel = next;
    set({ status: "connecting", path: current.kind, problem: null, block: null });
    next.onMessage((message) => {
      if (channel === next) handleMessage(message);
    });
    next.onState((state, reason) => {
      if (channel === next && state === "closed") handleChannelClosed(reason);
    });
    // The desktop stays silent until our first sealed frame opens (key confirmation), so a desktop
    // that cannot open it is indistinguishable from one that is slow: bound the wait.
    handshakeTimer = setTimeout(() => {
      if (channel === next && snapshot.status !== "online") next.close("handshake-timeout");
    }, HANDSHAKE_TIMEOUT_MS);
    next.start();
  }

  function handleMessage(raw: Readonly<Record<string, unknown>>): void {
    const message = parseAppMessage(raw);
    if (message === null) return;
    if (snapshot.status !== "online") {
      if (handshakeTimer !== null) clearTimeout(handshakeTimer);
      handshakeTimer = null;
      failures = 0;
      set({ status: "online", problem: null });
    }
    if (message.kind === "response") {
      rpc.handleResponse(message.response);
    } else if (message.kind === "event") {
      const { event } = message;
      if (event.ev === "desktop") set({ live: event.p });
      for (const listener of [...eventListeners]) listener(event);
    }
  }

  function handleChannelClosed(reason: string | null): void {
    if (reason === "update-phone" || reason === "update-desktop") {
      dropChannel(reason);
      dropLink();
      running = false;
      clearTimers();
      set({ status: "blocked", block: reason, problem: null, path: null });
      return;
    }
    // A failed handshake, too many forged frames, a timeout: start over on a fresh socket.
    dropChannel(reason ?? "closed");
    dropLink();
    set({ status: "connecting", path: null });
    scheduleRetry();
  }

  function goOffline(lastSeen: number | null): void {
    dropChannel("peer-offline");
    set({ status: "offline", path: link?.kind ?? null, lastSeen, problem: null });
  }

  function handleDown(down: LinkDown): void {
    dropChannel("link-down");
    link = null;
    if (down.kind === "revoked") {
      running = false;
      clearTimers();
      set({ status: "revoked", path: null, problem: null });
      return;
    }
    if (down.kind === "relay-error") {
      const problem = RELAY_ERROR_TEXT[down.code];
      if (TERMINAL_RELAY_ERRORS.has(down.code)) {
        running = false;
        clearTimers();
        set({ status: "failed", path: null, problem });
        return;
      }
      set({ status: "failed", path: null, problem });
      scheduleRetry();
      return;
    }
    const loud = failures + 1 >= QUIET_FAILURES;
    set({
      status: loud ? "failed" : "connecting",
      path: null,
      problem: loud ? "Can't reach the relay. Retrying." : null,
    });
    scheduleRetry();
  }

  function attempt(): void {
    retryTimer = null;
    if (!running) return;
    const kinds = order(snapshot.live);
    const kind = kinds[Math.min(kindIndex, kinds.length - 1)] ?? "relay";
    const mine = ++generation;
    const live = (): boolean => mine === generation;
    const opened = deps.openLink(kind, {
      onUp(info) {
        if (!live()) return;
        failures = 0;
        if (info.peerOnline) beginChannel();
        else goOffline(info.peerLastSeen);
      },
      onPeer(online, lastSeen) {
        if (!live()) return;
        if (!online) goOffline(lastSeen);
        else if (channel === null) beginChannel();
      },
      onFrame(bytes) {
        if (live()) channel?.receive(bytes);
      },
      onDown(down) {
        if (live()) handleDown(down);
      },
    });
    if (opened === null) {
      scheduleRetry();
      return;
    }
    link = opened;
    if (snapshot.status !== "offline") set({ status: "connecting", problem: null });
  }

  function start(): void {
    if (running || snapshot.status === "revoked") return;
    running = true;
    failures = 0;
    kindIndex = 0;
    attempt();
  }

  function stop(): void {
    running = false;
    clearTimers();
    dropChannel("stopped");
    dropLink();
    if (snapshot.status !== "revoked" && snapshot.status !== "blocked") {
      set({ status: "connecting", path: null, problem: null });
    }
  }

  return {
    rpc,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    sendControl(message) {
      if (link?.control === undefined || snapshot.status === "failed") return false;
      link.control(message);
      return true;
    },
    start,
    stop,
    retryNow() {
      if (snapshot.status === "revoked") return;
      stop();
      start();
    },
  };
}
