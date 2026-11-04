import type { PhoneChannel, SendResult } from "@protocol/channel";
import type { AppObject } from "@protocol/channel";
import type { LanAddress } from "@protocol/messages";
import { backoffDelay } from "./backoff";
import { lanCandidates, sameAddresses } from "./lan-addresses";
import type { Link, LinkHandlers } from "./relay-link";

/** A LAN channel must prove itself (the desktop's first message) within this, or the next address is tried. */
export const LAN_HANDSHAKE_TIMEOUT_MS = 5_000;

export interface LanUpgrade {
  /** The desktop's current LAN addresses; a different set resets the backoff and tries again. */
  offer(addresses: readonly LanAddress[]): void;
  /** Whether a working session over the relay exists; an upgrade is only tried from one. */
  setEligible(eligible: boolean): void;
  readonly active: boolean;
  send(message: object): SendResult;
  stop(): void;
}

/**
 * Moves a session onto the LAN when the desktop offers an address (MOB9) and back, by telling the
 * connection, when the LAN socket dies. It runs the same phone channel handshake over a LAN link,
 * tries each private address once with a short timeout, and after a failure retries later with
 * backoff (or at once for a new address set). It never touches pairing keys or the relay.
 */
export function createLanUpgrade(deps: {
  readonly openLan: (address: LanAddress, handlers: LinkHandlers) => Link;
  readonly createChannel: (send: (frame: Uint8Array) => void) => PhoneChannel;
  readonly random: () => number;
  /** The LAN channel proved itself: switch the session onto it. */
  readonly onActive: () => void;
  /** A message from the LAN channel, from the first (which proves it) on. */
  readonly onMessage: (message: AppObject) => void;
  /** The active LAN path died: fall back to the relay. */
  readonly onLost: () => void;
}): LanUpgrade {
  let offered: readonly LanAddress[] = [];
  let eligible = false;
  let active = false;
  let trying = false;
  let failures = 0;
  let generation = 0;
  let link: Link | null = null;
  let channel: PhoneChannel | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (handshakeTimer !== null) clearTimeout(handshakeTimer);
    retryTimer = null;
    handshakeTimer = null;
  }

  function teardown(): void {
    generation++;
    clearTimers();
    const oldChannel = channel;
    const oldLink = link;
    channel = null;
    link = null;
    oldChannel?.close("lan-closed");
    oldLink?.close();
  }

  function scheduleRetry(): void {
    if (offered.length === 0) return;
    const delay = backoffDelay(failures, deps.random);
    failures++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start();
    }, delay);
  }

  function failed(index: number, candidates: readonly LanAddress[], wasActive: boolean): void {
    teardown();
    if (wasActive) {
      active = false;
      deps.onLost();
      scheduleRetry();
      return;
    }
    if (index + 1 < candidates.length && eligible) attempt(candidates, index + 1);
    else {
      trying = false;
      scheduleRetry();
    }
  }

  function attempt(candidates: readonly LanAddress[], index: number): void {
    const mine = ++generation;
    const live = (): boolean => mine === generation;
    trying = true;
    link = deps.openLan(candidates[index], {
      onUp() {
        if (!live() || link === null) return;
        const current = link;
        const next = deps.createChannel((frame) => current.send(frame));
        channel = next;
        next.onMessage((message) => {
          if (channel !== next) return;
          if (!active) {
            // The desktop answered over this channel: it opened our first sealed frame.
            if (handshakeTimer !== null) clearTimeout(handshakeTimer);
            handshakeTimer = null;
            active = true;
            trying = false;
            failures = 0;
            deps.onActive();
          }
          deps.onMessage(message);
        });
        next.onState((state) => {
          if (channel === next && state === "closed") failed(index, candidates, active);
        });
        handshakeTimer = setTimeout(() => {
          if (live() && !active) failed(index, candidates, false);
        }, LAN_HANDSHAKE_TIMEOUT_MS);
        next.start();
      },
      onPeer() {},
      onFrame(bytes) {
        if (live()) channel?.receive(bytes);
      },
      onDown() {
        if (live()) failed(index, candidates, active);
      },
    });
  }

  function start(): void {
    if (active || trying || !eligible) return;
    const candidates = lanCandidates(offered);
    if (candidates.length === 0) return;
    attempt(candidates, 0);
  }

  return {
    offer(addresses) {
      const changed = !sameAddresses(offered, addresses);
      offered = addresses;
      if (!changed) return;
      if (active) return; // a working path is not moved because the list changed
      // New addresses are worth trying now, not after the backoff of the old ones.
      failures = 0;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      if (!trying) start();
    },
    setEligible(next) {
      eligible = next;
      if (next) {
        if (retryTimer === null && !trying && !active) start();
      }
    },
    get active() {
      return active;
    },
    send(message) {
      return active ? (channel?.sendMessage(message) ?? "not-open") : "not-open";
    },
    stop() {
      // Back to a clean slate: the connection sets eligibility again when it is running.
      eligible = false;
      active = false;
      trying = false;
      failures = 0;
      teardown();
    },
  };
}
