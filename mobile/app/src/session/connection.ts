import { createPhoneChannel, type PhoneChannel } from "@protocol/channel";
import type { CryptoProvider } from "@protocol/crypto";
import { parseAppMessage, type AppEvent, type LanAddress } from "@protocol/messages";
import { RELAY_ERROR_TEXT, type ClientToRelay } from "@protocol/relay-messages";
import { backoffDelay } from "./backoff";
import { createLanUpgrade, type LanUpgrade } from "./lan-upgrade";
import type { Link, LinkDown, LinkFactory, LinkHandlers, LinkKind } from "./relay-link";
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
  /**
   * Counts moves between paths while the session stays online, so whoever holds subscriptions
   * (tree, panes) knows to subscribe again on the new path.
   */
  readonly epoch: number;
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
   * Opens the direct LAN link to one address (MOB9). Without it the connection stays on the relay.
   * The relay link stays up either way, for presence and push registration.
   */
  readonly openLan?: (address: LanAddress, handlers: LinkHandlers) => Link;
}

const INITIAL: ConnectionSnapshot = {
  status: "connecting",
  path: null,
  lastSeen: null,
  epoch: 0,
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

/** How often a blocked desktop is tried again (a forged verdict must not block it for good). */
export const BLOCKED_RETRY_MS = 60_000;

export function createDesktopConnection(deps: ConnectionDeps): DesktopConnection {
  const random = deps.random ?? Math.random;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: AppEvent) => void>();

  let snapshot: ConnectionSnapshot = INITIAL;
  let running = false;
  let generation = 0; // a callback from a replaced link carries an old number and is dropped
  let link: Link | null = null;
  let channel: PhoneChannel | null = null;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  let lan: LanUpgrade | null = null;
  const baseRpc = createRpc((message) =>
    lan?.active === true ? lan.send(message) : (channel?.sendMessage(message) ?? "not-open"),
  );
  // Streams opened over the relay channel keep running on the desktop after the phone stops
  // listening to that channel, so a move to the LAN ends them first (the LAN gets its own).
  let relayTree = false;
  const relaySubs = new Set<string>();
  /** Subscribes sent over the relay whose answer has not come back: they may still start a stream. */
  const inflight = new Set<Promise<unknown>>();
  let courtesyId = 1_000_000_000;
  const rpc: RpcClient = {
    ...baseRpc,
    request(method, params, options) {
      const onRelay = lan?.active !== true;
      const pending = baseRpc.request(method, params, options);
      if (onRelay) {
        if (method === "tree.subscribe" || method === "pane.subscribe") {
          const tracked = pending.then(
            (r) => {
              if (method === "tree.subscribe") relayTree = true;
              else if ("sub" in r) relaySubs.add(r.sub);
            },
            () => {},
          );
          inflight.add(tracked);
          void tracked.then(() => inflight.delete(tracked));
        }
        if (method === "tree.unsubscribe") relayTree = false;
        if (method === "pane.unsubscribe") relaySubs.delete((params as { sub: string }).sub);
      }
      return pending;
    },
  };
  /** How long a subscribe that is still in flight on the relay is waited for before leaving it. */
  const LEAVE_WAIT_MS = 3_000;

  function sendRelayUnsubscribes(): void {
    const send = (m: string, p: object): void => {
      channel?.sendMessage({ id: courtesyId++, m, p });
    };
    if (relayTree) send("tree.unsubscribe", {});
    for (const sub of relaySubs) send("pane.unsubscribe", { sub });
    relayTree = false;
    relaySubs.clear();
  }

  /**
   * Leaves the relay channel for the LAN: waits for subscribes still in flight (their answers name
   * the streams to end), ends every stream on the relay, then closes the channel. If the relay
   * channel was replaced or lost meanwhile there is nothing left to end.
   */
  function leaveRelayChannel(): void {
    const old = channel;
    if (old === null) return;
    const finish = (): void => {
      if (channel !== old) return;
      sendRelayUnsubscribes();
      dropChannel("lan-active");
    };
    if (inflight.size === 0) {
      finish();
      return;
    }
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      finish();
    };
    void Promise.all([...inflight]).then(once);
    setTimeout(once, LEAVE_WAIT_MS);
  }

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
    set({
      status: snapshot.status === "blocked" ? "blocked" : "connecting",
      path: current.kind,
      problem: null,
    });
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
      set({ status: "online", problem: null, block: null });
      lan?.setEligible(true); // a working relay session: the direct path may be tried
    }
    if (message.kind === "response") {
      rpc.handleResponse(message.response);
    } else if (message.kind === "event") {
      const { event } = message;
      if (event.ev === "desktop") {
        set({ live: event.p });
        lan?.offer(event.p.lan);
      }
      for (const listener of [...eventListeners]) listener(event);
    }
  }

  function handleChannelClosed(reason: string | null): void {
    if (reason === "update-phone" || reason === "update-desktop") {
      dropChannel(reason);
      dropLink();
      clearTimers();
      set({ status: "blocked", block: reason, problem: null, path: null });
      // The verdict is the desktop's word, but it arrives before anything is authenticated, so a
      // relay in the middle could forge it. The block is shown, and the phone keeps checking
      // slowly (and again whenever the app returns to the front), so it cannot be silenced for good.
      retryTimer = setTimeout(attempt, BLOCKED_RETRY_MS);
      return;
    }
    // A failed handshake, too many forged frames, a timeout: start over on a fresh socket.
    dropChannel(reason ?? "closed");
    dropLink();
    set({ status: "connecting", path: null });
    scheduleRetry();
  }

  function goOffline(lastSeen: number | null): void {
    // The relay's word on presence says nothing about a working direct path.
    if (lan?.active === true) return;
    lan?.setEligible(false);
    dropChannel("peer-offline");
    set({ status: "offline", path: link?.kind ?? null, lastSeen, problem: null });
  }

  function handleDown(down: LinkDown): void {
    link = null;
    if (lan?.active === true && down.kind !== "revoked") {
      // The relay dropped but the direct path works: reconnect the relay quietly, keep the session.
      scheduleRetry();
      return;
    }
    lan?.setEligible(false);
    dropChannel("link-down");
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
    // One relay link at a time: a pending retry and a link from an earlier attempt are dropped, so
    // two paths to `attempt()` (the timer and a LAN fallback) cannot leave an orphan socket open.
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    if (link !== null) dropLink();
    if (!running) return;
    const mine = ++generation;
    const live = (): boolean => mine === generation;
    const opened = deps.openLink("relay", {
      onUp(info) {
        if (!live()) return;
        failures = 0;
        if (lan?.active === true) return; // already on the direct path; the relay is back for presence
        if (info.peerOnline) beginChannel();
        else goOffline(info.peerLastSeen);
      },
      onPeer(online, lastSeen) {
        if (!live()) return;
        if (!online) goOffline(lastSeen);
        else if (channel === null && lan?.active !== true) beginChannel();
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
    if (snapshot.status !== "offline" && snapshot.status !== "blocked") {
      set({ status: "connecting", problem: null });
    }
  }

  if (deps.openLan !== undefined) {
    lan = createLanUpgrade({
      openLan: deps.openLan,
      createChannel: (send) =>
        createPhoneChannel({
          crypto: deps.crypto,
          pairing: deps.pairing,
          send,
          session: deps.session,
        }),
      random,
      onActive() {
        // Move the session: the relay channel goes (the desktop drops its streams for it), the
        // relay socket stays for presence and push. Subscribers see the epoch change and subscribe
        // again over the LAN.
        leaveRelayChannel();
        set({ status: "online", path: "lan", problem: null, epoch: snapshot.epoch + 1 });
      },
      onMessage: handleMessage,
      onLost() {
        // The direct path died: back to the relay at once, on a fresh relay session (the desktop's
        // session on the old relay socket already did its handshake and cannot do another), and
        // subscribers replay there.
        dropChannel("lan-lost");
        dropLink();
        failures = 0;
        set({ status: "connecting", path: null, epoch: snapshot.epoch + 1 });
        if (running) attempt();
      },
    });
  }

  function start(): void {
    if (snapshot.status === "revoked") return;
    if (running) {
      // The app came back to the front while blocked: check again now.
      if (snapshot.status === "blocked") attempt();
      return;
    }
    running = true;
    failures = 0;
    attempt();
  }

  function stop(): void {
    running = false;
    clearTimers();
    lan?.stop();
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
