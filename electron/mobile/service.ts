/**
 * The desktop side of the iPhone companion, assembled (mobile design §7). Built in `main.ts` only
 * while the `mobileCompanion` switch is on; with it off nothing here exists, so no socket opens
 * and no handler does more than answer `enabled: false`.
 *
 * Owns the relay connections (one per paired phone, plus one for the pairing that is waiting for a
 * scan), turns each phone's `hello` into a `PhoneSession`, and wires the pieces that need Electron
 * through injected functions: the window coordinator, the pane mirror, the power blocker. The
 * relay never sees plaintext and neither does this module's log: only counts and codes.
 */
import { hostname } from "node:os";
import type { CryptoProvider } from "../../mobile/protocol/src/crypto";
import { b64urlDecode } from "../../mobile/protocol/src/encoding";
import { derivePushKey } from "../../mobile/protocol/src/keys";
import type { LanAddress, OS_NAMES } from "../../mobile/protocol/src/messages";
import { sealPush, type PushEventKind } from "../../mobile/protocol/src/push";
import type { ControlReplyPayload } from "../../src/lib/control-command";
import {
  DISABLED_MOBILE_STATE,
  type MobileStartResult,
  type MobileState,
} from "../../src/lib/mobile-state";
import type { UsageSnapshot } from "../../src/lib/usage-snapshot";
import type { PaneMirror } from "../control/pane-mirror";
import { EVENTS } from "../ipc/channels";
import { createKeepAwake, type PowerBlocker } from "./keep-awake";
import { createPairingService, desktopName, PAIR_FAILURE_TEXT } from "./pairing";
import type { PairingStore, StoredPairing } from "./pairing-store";
import { createPhoneExecutor } from "./phone-executor";
import { createPhoneFiles } from "./phone-files";
import { createPhoneForwarder } from "./phone-forwarder";
import { createPhonePanes } from "./phone-panes";
import { createQueryBroker, type QueryKind } from "./phone-queries";
import {
  createLanListener,
  type LanListener,
  type LanListenerDeps,
  type LanSessionHandle,
} from "./lan-listener";
import { createPhoneSession, type PhoneSession } from "./phone-session";
import { createStreamHub, type StreamMessage } from "./phone-streams";
import { createTreeHub } from "./phone-tree";
import {
  createRelayConnection,
  type RelayConnection,
  type RelaySocketFactory,
} from "./relay-client";
import type { WsConnection } from "./ws-server";

export type { MobileState, MobileStartResult };
export const DISABLED_STATE = DISABLED_MOBILE_STATE;

/** Telemetry (T11) will count these; for now nothing listens. */
export type MobileUsageKind = "session" | "send" | "open";

export interface PushRequest {
  readonly paneId: number;
  readonly kind: PushEventKind;
  readonly title: string;
  readonly body: string;
}

export interface MobileServiceDeps {
  readonly crypto: CryptoProvider;
  readonly store: PairingStore;
  readonly relayUrl: () => string | null;
  readonly fetch: Parameters<typeof createPairingService>[0]["fetch"];
  readonly appVersion: string;
  readonly platform: NodeJS.Platform;
  readonly mirror: PaneMirror;
  /** The window coordinator and window registry, as functions. */
  readonly windows: {
    ownerOf(paneId: number): string | null;
    deliver(paneId: number, event: string, payload: unknown): void;
    emitTo(label: string, event: string, payload: unknown): boolean;
    labels(): readonly string[];
    focused(): string | null;
    main(): string | null;
    /** Whether any Deck window has the keyboard focus right now. */
    anyFocused(): boolean;
  };
  readonly usage: () => Promise<UsageSnapshot>;
  readonly blocker: PowerBlocker;
  readonly broadcastChanged: () => void;
  readonly createSocket?: RelaySocketFactory;
  /**
   * The LAN path (MOB9). Absent means no LAN listener at all (tests); `main` passes `{}` for the
   * defaults. The overrides exist so tests can feed interface tables and short deadlines.
   */
  readonly lan?: Pick<
    LanListenerDeps,
    "listInterfaces" | "isAllowed" | "handshakeTimeoutMs" | "refreshMs" | "maxSockets"
  >;
  readonly log: (message: string) => void;
  readonly now?: () => number;
  readonly onUsage?: (kind: MobileUsageKind) => void;
}

export interface MobileService {
  start(): Promise<void>;
  state(): MobileState;
  pairStart(): Promise<MobileStartResult>;
  pairCancel(): MobileState;
  revoke(pairingId: string): Promise<MobileState>;
  settleControlReply(fromWindow: string, reply: ControlReplyPayload): boolean;
  settleQuery(fromWindow: string, requestId: string, kind: QueryKind, payload: unknown): boolean;
  streamData(fromWindow: string, message: StreamMessage): boolean;
  /** The renderer's notifier decided a phone should hear about a pane. */
  push(request: PushRequest): void;
  paneGone(paneId: number): void;
  /** Wraps the mirror so every report re-evaluates keep-awake. */
  observeMirror(mirror: PaneMirror): PaneMirror;
  /** The LAN addresses currently offered to phones; empty while the listener is off. */
  lanAddresses(): readonly LanAddress[];
  dispose(): void;
}

interface Link {
  readonly relay: RelayConnection;
  session: PhoneSession | null;
  online: boolean;
}

const HELLO_FRAME = 0x01;
const PAIR_HELLO_FRAME = 0x10;
/** Lets the relay deliver `revoked` to the phone before the desktop's socket goes away. */
const REVOKE_LINGER_MS = 1_000;

export function createMobileService(deps: MobileServiceDeps): MobileService {
  const now = deps.now ?? Date.now;
  const usage = deps.onUsage ?? (() => {});
  const links = new Map<string, Link>();
  const hostName = () => desktopName(hostname());
  let disposed = false;

  // ------------------------------------------------------------------ renderer-facing hubs
  const broker = createQueryBroker({
    windows: () => deps.windows.labels(),
    send: (label, requestId, kind) =>
      void deps.windows.emitTo(label, EVENTS.mobileQueryRequest, { requestId, kind }),
  });
  const tree = createTreeHub({ broker, mirror: deps.mirror });
  const streams = createStreamHub({
    ownerOf: (paneId) => deps.windows.ownerOf(paneId),
    startStream: (paneId, subscriptionId) =>
      deps.windows.deliver(paneId, EVENTS.mobileStreamSubscribe, { subscriptionId, paneId }),
    stopStream: (label, subscriptionId) =>
      void deps.windows.emitTo(label, EVENTS.mobileStreamUnsubscribe, { subscriptionId }),
  });
  const phoneForwarder = createPhoneForwarder({
    windowOf: (paneId) => deps.windows.ownerOf(paneId),
    deliver: (paneId, event, payload) => deps.windows.deliver(paneId, event, payload),
    emitTo: (label, event, payload) => deps.windows.emitTo(label, event, payload),
    log: deps.log,
  });
  const panes = createPhonePanes({
    forwarder: phoneForwarder.forwarder,
    forwardOpen: (label, fields, timeoutMs) => phoneForwarder.openIn(label, fields, timeoutMs),
    mirror: deps.mirror,
    windowOf: (paneId) => deps.windows.ownerOf(paneId),
    sendInput: (paneId, data) => {
      if (deps.windows.ownerOf(paneId) === null) return false;
      deps.windows.deliver(paneId, EVENTS.mobileInput, { paneId, data });
      return true;
    },
    tree,
    focusedWindow: () => deps.windows.focused(),
    mainWindow: () => deps.windows.main(),
    log: deps.log,
  });
  const executor = createPhoneExecutor({
    panes,
    files: createPhoneFiles({ isKnownRoot: (root) => tree.isKnownRoot(root) }),
    tree,
    streams,
    usage: deps.usage,
    log: deps.log,
    onUsage: (kind) => usage(kind),
  });

  // ------------------------------------------------------------------ keep-awake
  const keepAwake = createKeepAwake({
    blocker: deps.blocker,
    workingPanes: () => deps.mirror.list().filter(({ state }) => state.phase === "working").length,
    pairedPhones: () => deps.store.list().length,
  });

  // ------------------------------------------------------------------ pairing
  const pairing = createPairingService({
    crypto: deps.crypto,
    store: deps.store,
    relayUrl: deps.relayUrl,
    fetch: deps.fetch,
    appVersion: deps.appVersion,
    platform: deps.platform,
    now,
    hostName: () => hostname(),
    onPendingChanged: () => {
      syncPendingLink();
      deps.broadcastChanged();
    },
    onPaired: (record) => {
      // The pending pairing's socket is the phone's socket from here on: same id, same token.
      const link = links.get(record.pairingId);
      if (link !== undefined) link.online = true;
      keepAwake.evaluate();
      syncLan();
    },
    onRevoked: (record) => {
      const link = links.get(record.pairingId);
      if (link !== undefined) {
        link.relay.sendControl({ t: "revoke" });
        link.session?.close("revoked");
        links.delete(record.pairingId);
        const timer = setTimeout(() => link.relay.close(), REVOKE_LINGER_MS);
        timer.unref?.();
      }
      for (const entry of [...lanSessions.values()]) {
        if (entry.pairingId === record.pairingId) entry.session.close("revoked");
      }
      syncLan();
      keepAwake.evaluate();
      deps.broadcastChanged();
    },
  });

  function lookup(pairingId: string): Uint8Array | null {
    const record = deps.store.get(pairingId);
    return record === null ? null : b64urlDecode(record.pairKey);
  }

  /** One relay socket for a pairing; frames go to pairing, then to the phone's session. */
  function connect(pairingId: string, relayUrl: string, token: string): void {
    if (disposed || links.has(pairingId)) return;
    const link: Link = {
      relay: undefined as unknown as RelayConnection,
      session: null,
      online: false,
    };
    const relay = createRelayConnection({
      relayUrl,
      pairingId,
      role: "desktop",
      token,
      ...(deps.createSocket === undefined ? {} : { createSocket: deps.createSocket }),
      onBinary: (frame) => void onFrame(pairingId, link, frame),
      onReady: ({ peerOnline }) => {
        link.online = peerOnline;
        deps.broadcastChanged();
      },
      onPeer: ({ online }) => {
        link.online = online;
        if (online) deps.store.touch(pairingId, now());
        deps.broadcastChanged();
      },
      onConnected: (up) => {
        if (!up) link.online = false;
        deps.broadcastChanged();
      },
      onStop: (reason) => {
        if (reason === "revoked" && deps.store.get(pairingId) !== null) {
          // The phone revoked from its side: forget it here too.
          void pairing.revoke(pairingId);
        }
        links.delete(pairingId);
        deps.broadcastChanged();
      },
    });
    (link as { relay: RelayConnection }).relay = relay;
    links.set(pairingId, link);
    relay.connect();
  }

  async function onFrame(pairingId: string, link: Link, frame: Uint8Array): Promise<void> {
    if (frame[0] === PAIR_HELLO_FRAME) {
      const reply = await pairing.handleFrame(pairingId, frame);
      if (reply !== null) link.relay.sendBinary(reply);
      return;
    }
    if (deps.store.get(pairingId) === null) return;
    if (frame[0] === HELLO_FRAME) {
      link.session?.close("replaced");
      link.session = buildSession(pairingId, (out) => void link.relay.sendBinary(out));
    }
    link.session?.receive(frame);
  }

  /** The desktop end of one phone on one transport; the relay and the LAN build it the same way. */
  function buildSession(pairingId: string, send: (frame: Uint8Array) => void): PhoneSession {
    return createPhoneSession({
      crypto: deps.crypto,
      lookup,
      send,
      executor,
      hello: () => ({
        name: hostName(),
        os: (deps.platform === "darwin"
          ? "macos"
          : deps.platform === "win32"
            ? "windows"
            : "linux") satisfies (typeof OS_NAMES)[number],
        appVersion: deps.appVersion,
        lan: lanAddresses,
      }),
      log: deps.log,
      onOpen: () => {
        deps.store.touch(pairingId, now());
        usage("session");
        deps.broadcastChanged();
      },
    });
  }

  // ------------------------------------------------------------------ LAN (MOB9)
  let lanAddresses: readonly LanAddress[] = [];
  const lanSessions = new Map<WsConnection, { pairingId: string; session: PhoneSession }>();

  function openLanSession(pairingId: string, connection: WsConnection): LanSessionHandle {
    const session = buildSession(pairingId, (out) => void connection.send(out));
    lanSessions.set(connection, { pairingId, session });
    session.channel.onState((state) => {
      if (state === "open" && session.pairingId !== pairingId) {
        // The hello named another pairing than the path did: a client that is not our phone app.
        session.close("pairing-mismatch");
      }
      if (state === "closed") {
        lanSessions.delete(connection);
        connection.close();
      }
    });
    connection.onMessage((bytes) => session.receive(bytes));
    return {
      isOpen: () => session.channel.state === "open",
      close: (reason) => session.close(reason),
    };
  }

  const lanListener: LanListener | null =
    deps.lan === undefined
      ? null
      : createLanListener({
          ...deps.lan,
          isKnown: (pairingId) => deps.store.get(pairingId) !== null,
          openSession: openLanSession,
          log: deps.log,
          onAddresses: (addresses) => {
            lanAddresses = addresses;
            // Every open session learns the new address set; a stale one just fails and falls back.
            for (const link of links.values()) link.session?.announce();
            for (const { session } of lanSessions.values()) session.announce();
          },
        });

  /** Listens only while at least one phone is paired and the service exists (switch on). */
  function syncLan(): void {
    if (lanListener === null) return;
    if (!disposed && deps.store.list().length > 0) void lanListener.start();
    else lanListener.stop();
  }

  /** The pending pairing needs a socket to hear `pair-hello`; drop it when the pairing ends unpaired. */
  function syncPendingLink(): void {
    const pending = pairing.pending();
    if (pending !== null) {
      connect(pending.pairingId, pending.relayUrl, pending.desktopToken);
      return;
    }
    for (const [pairingId, link] of [...links]) {
      if (deps.store.get(pairingId) === null) {
        link.relay.close();
        links.delete(pairingId);
      }
    }
  }

  function state(): MobileState {
    const pending = pairing.pending();
    return {
      enabled: true,
      encryptionAvailable: deps.store.encryptionAvailable(),
      phones: pairing.phones().map((phone) => ({
        ...phone,
        model: phone.model,
        online: links.get(phone.pairingId)?.online ?? false,
      })),
      pending: pending === null ? null : { qr: pending.qr, expiresAt: pending.expiresAt },
    };
  }

  function push(request: PushRequest): void {
    // The phone is for when you are away (decision 23): any focused Deck window silences it.
    if (disposed || deps.windows.anyFocused()) return;
    for (const record of deps.store.list()) {
      const link = links.get(record.pairingId);
      if (link === undefined) continue;
      const pushKey = derivePushKey(deps.crypto, b64urlDecode(record.pairKey));
      try {
        const data = sealPush(deps.crypto, pushKey, {
          title: request.title,
          body: request.body,
          paneId: request.paneId,
          kind: request.kind,
          desktop: hostName(),
          at: now(),
        });
        link.relay.sendControl({ t: "push", data });
      } catch {
        deps.log("Deck: a phone notification could not be sealed");
      }
    }
  }

  return {
    async start() {
      await deps.store.load();
      for (const record of deps.store.list()) connectRecord(record);
      syncLan();
      keepAwake.evaluate();
    },
    state,
    async pairStart() {
      const result = await pairing.start();
      if (result.ok) return { ...state(), error: null };
      return {
        ...state(),
        error: { reason: result.reason, message: PAIR_FAILURE_TEXT[result.reason] },
      };
    },
    pairCancel() {
      pairing.cancel();
      return state();
    },
    async revoke(pairingId) {
      await pairing.revoke(pairingId);
      return state();
    },
    settleControlReply: (from, reply) => phoneForwarder.settle(from, reply),
    settleQuery: (from, requestId, kind, payload) => broker.settle(from, requestId, kind, payload),
    streamData: (from, message) => streams.fromRenderer(from, message),
    push,
    paneGone(paneId) {
      streams.paneGone(paneId);
      keepAwake.evaluate();
    },
    observeMirror(mirror) {
      return {
        ...mirror,
        report(paneId, report) {
          mirror.report(paneId, report);
          keepAwake.evaluate();
        },
        forget(paneId) {
          mirror.forget(paneId);
          keepAwake.evaluate();
        },
      };
    },
    lanAddresses: () => lanAddresses,
    dispose() {
      disposed = true;
      lanListener?.stop();
      for (const { session } of [...lanSessions.values()]) session.close("quit");
      keepAwake.release();
      for (const link of links.values()) {
        link.session?.close("quit");
        link.relay.close();
      }
      links.clear();
    },
  };

  function connectRecord(record: StoredPairing): void {
    connect(record.pairingId, record.relayUrl, record.desktopToken);
  }
}
