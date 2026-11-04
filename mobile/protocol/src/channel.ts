/**
 * The secure channel (design §4) as two pure state machines. Transport, crypto and the version
 * judge are injected, so the same code runs over the relay, over the LAN socket and in tests.
 *
 * Trust model: the relay sees and can alter every byte. Keys mix the pairing's long-term key with
 * fresh ephemeral keys and the transcript, so a relay that swaps anything derives nothing; a frame
 * it alters or replays fails to open and is dropped and counted, never acted on.
 */
import type { CryptoProvider } from "./crypto";
import { concatBytes, u64be, utf8Decode, utf8Encode } from "./encoding";
import { decodeFrame, encodeFrame, FRAME_TYPE, type Frame, type HelloBody } from "./frames";
import { deriveSessionKeys } from "./keys";
import { MAX_AUTH_FAILURES, MAX_MESSAGE_BYTES } from "./limits";
import { judgeVersion, PROTOCOL_MIN, PROTOCOL_VERSION, type VersionVerdict } from "./version";
import { isRecord, parseJsonText } from "./validate";

export type ChannelState = "handshaking" | "open" | "closed";
export type AppObject = Readonly<Record<string, unknown>>;
export type SendResult = "sent" | "not-open" | "too-large";

export interface SecureChannel {
  readonly state: ChannelState;
  /** Frames dropped because they would not open, were out of order or were malformed. */
  readonly failures: number;
  /** Why the channel closed (`"update-phone"`, `"auth-failures"`, a caller's reason, ...). */
  readonly closeReason: string | null;
  /** Feed one binary message from the transport. Never throws. */
  receive(frame: Uint8Array): void;
  sendMessage(message: object): SendResult;
  onMessage(listener: (message: AppObject) => void): () => void;
  onState(listener: (state: ChannelState, reason: string | null) => void): () => void;
  close(reason: string): void;
}

export interface VersionRange {
  readonly version: number;
  readonly min: number;
}
const LOCAL_VERSION: VersionRange = { version: PROTOCOL_VERSION, min: PROTOCOL_MIN };

const NONCE_PREFIX = new Uint8Array(4);

function sealedNonce(counter: number): Uint8Array {
  return concatBytes(NONCE_PREFIX, u64be(counter));
}
function sealedAad(counter: number): Uint8Array {
  return concatBytes(Uint8Array.of(FRAME_TYPE.sealed), u64be(counter));
}

interface Core {
  readonly api: Pick<
    SecureChannel,
    "failures" | "closeReason" | "state" | "onMessage" | "onState" | "close"
  >;
  fail(): void;
  close(reason: string): void;
  setKeys(sendKey: Uint8Array, receiveKey: Uint8Array): void;
  hasKeys(): boolean;
  /** Opens a sealed frame, or null after counting the failure. */
  open(frame: Extract<Frame, { type: "sealed" }>): AppObject | null;
  seal(message: object): { result: SendResult; frame?: Uint8Array };
  emit(message: AppObject): void;
  setOpen(): void;
  readonly state: ChannelState;
}

function createCore(crypto: CryptoProvider): Core {
  let state: ChannelState = "handshaking";
  let failures = 0;
  let closeReason: string | null = null;
  let sendKey: Uint8Array | null = null;
  let receiveKey: Uint8Array | null = null;
  let sendCounter = 0;
  let receiveCounter = 0;
  const messageListeners = new Set<(message: AppObject) => void>();
  const stateListeners = new Set<(state: ChannelState, reason: string | null) => void>();

  function transition(next: ChannelState, reason: string | null): void {
    state = next;
    for (const listener of [...stateListeners]) listener(next, reason);
  }

  const core: Core = {
    get state() {
      return state;
    },
    api: {
      get state() {
        return state;
      },
      get failures() {
        return failures;
      },
      get closeReason() {
        return closeReason;
      },
      onMessage(listener) {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      onState(listener) {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
      close(reason) {
        core.close(reason);
      },
    },
    fail() {
      failures++;
      if (failures >= MAX_AUTH_FAILURES) core.close("auth-failures");
    },
    close(reason) {
      if (state === "closed") return;
      closeReason = reason;
      // The keys are the only secrets a session holds; drop them with the session.
      sendKey = null;
      receiveKey = null;
      transition("closed", reason);
    },
    setKeys(send, receive) {
      sendKey = send;
      receiveKey = receive;
    },
    hasKeys() {
      return sendKey !== null;
    },
    setOpen() {
      if (state === "handshaking") transition("open", null);
    },
    open(frame) {
      if (state === "closed" || receiveKey === null) return null;
      if (frame.counter !== receiveCounter) {
        core.fail();
        return null;
      }
      const plaintext = crypto.open(
        receiveKey,
        sealedNonce(frame.counter),
        frame.ciphertext,
        sealedAad(frame.counter),
      );
      if (plaintext === null) {
        core.fail();
        return null;
      }
      // Authentic from here on, so the counter advances even if the content is unusable.
      receiveCounter++;
      let value: unknown;
      try {
        value =
          plaintext.length > MAX_MESSAGE_BYTES ? undefined : parseJsonText(utf8Decode(plaintext));
      } catch {
        value = undefined;
      }
      if (!isRecord(value)) {
        core.fail();
        return null;
      }
      return value;
    },
    seal(message) {
      if (state === "closed" || sendKey === null) return { result: "not-open" };
      const plaintext = utf8Encode(JSON.stringify(message));
      if (plaintext.length > MAX_MESSAGE_BYTES) return { result: "too-large" };
      const counter = sendCounter++;
      const ciphertext = crypto.seal(sendKey, sealedNonce(counter), plaintext, sealedAad(counter));
      return { result: "sent", frame: encodeFrame({ type: "sealed", counter, ciphertext }) };
    },
    emit(message) {
      for (const listener of [...messageListeners]) listener(message);
    },
  };
  return core;
}

// --- phone ---------------------------------------------------------------------------------

export interface PhoneChannel extends SecureChannel {
  /** Sends `hello`; call once the transport is open. */
  start(): void;
  /** The version verdict once the desktop answered, null before. */
  readonly verdict: VersionVerdict | null;
}

export function createPhoneChannel(options: {
  readonly crypto: CryptoProvider;
  readonly pairing: { readonly pairingId: string; readonly pairKey: Uint8Array };
  readonly send: (frame: Uint8Array) => void;
  /** Sent as the first sealed message, `session.start`. */
  readonly session: { readonly device: string; readonly appVersion: string };
  readonly local?: VersionRange;
}): PhoneChannel {
  const { crypto, pairing, send } = options;
  const local = options.local ?? LOCAL_VERSION;
  const core = createCore(crypto);
  let ephemeral: { secretKey: Uint8Array; publicKey: Uint8Array } | null = null;
  let helloBytes: Uint8Array | null = null;
  let verdict: VersionVerdict | null = null;

  function onWelcome(frame: Extract<Frame, { type: "welcome" }>, raw: Uint8Array): void {
    if (ephemeral === null || helloBytes === null || core.hasKeys()) {
      core.fail();
      return;
    }
    const body = frame.body;
    // Judge from both ranges ourselves: an unauthenticated `verdict` field alone could be forged.
    const own = judgeVersion(local, { version: body.v, min: body.min });
    verdict = body.verdict !== "ok" ? body.verdict : own;
    if (verdict !== "ok") {
      core.close(verdict);
      return;
    }
    let keys: ReturnType<typeof deriveSessionKeys>;
    try {
      keys = deriveSessionKeys(crypto, {
        pairKey: pairing.pairKey,
        ownEphemeralSecret: ephemeral.secretKey,
        peerEphemeralPublic: body.eph,
        helloFrame: helloBytes,
        welcomeFrame: raw,
      });
    } catch {
      core.close("handshake-failed");
      return;
    }
    ephemeral = null;
    core.setKeys(keys.p2d, keys.d2p);
    core.setOpen();
    // Key confirmation: the desktop stays silent until this frame opens.
    const sealed = core.seal({ ev: "session.start", p: options.session });
    if (sealed.frame !== undefined) send(sealed.frame);
  }

  return {
    get state() {
      return core.api.state;
    },
    get failures() {
      return core.api.failures;
    },
    get closeReason() {
      return core.api.closeReason;
    },
    get verdict() {
      return verdict;
    },
    onMessage: core.api.onMessage,
    onState: core.api.onState,
    close: core.api.close,
    start() {
      if (helloBytes !== null || core.state === "closed") return;
      ephemeral = crypto.x25519KeyPair();
      const body: HelloBody = {
        v: local.version,
        min: local.min,
        pairingId: pairing.pairingId,
        eph: ephemeral.publicKey,
        nonce: crypto.randomBytes(16),
      };
      helloBytes = encodeFrame({ type: "hello", body });
      send(helloBytes);
    },
    receive(raw) {
      if (core.state === "closed") return;
      const frame = decodeFrame(raw);
      if (frame === null) {
        core.fail();
        return;
      }
      if (frame.type === "welcome") {
        onWelcome(frame, raw);
      } else if (frame.type === "sealed" && core.state === "open") {
        const message = core.open(frame);
        if (message !== null) core.emit(message);
      } else {
        core.fail();
      }
    },
    sendMessage(message) {
      if (core.state !== "open") return "not-open";
      const sealed = core.seal(message);
      if (sealed.frame !== undefined) send(sealed.frame);
      return sealed.result;
    },
  };
}

// --- desktop -------------------------------------------------------------------------------

export interface DesktopChannel extends SecureChannel {
  /** The pairing the phone named in `hello`, once accepted. */
  readonly pairingId: string | null;
  readonly verdict: VersionVerdict | null;
  /** From the phone's `session.start`, once the channel is open. */
  readonly phone: { readonly device: string; readonly appVersion: string } | null;
}

export function createDesktopChannel(options: {
  readonly crypto: CryptoProvider;
  /** The pairKey of a pairing this desktop still honours, else null (revoked or never paired). */
  readonly lookup: (pairingId: string) => Uint8Array | null;
  readonly send: (frame: Uint8Array) => void;
  readonly local?: VersionRange;
  /** Defaults to `judgeVersion`; injected so a test can force a verdict. */
  readonly judge?: (phone: VersionRange) => VersionVerdict;
}): DesktopChannel {
  const { crypto, lookup, send } = options;
  const local = options.local ?? LOCAL_VERSION;
  const judge = options.judge ?? ((phone: VersionRange) => judgeVersion(phone, local));
  const core = createCore(crypto);
  let pairingId: string | null = null;
  let verdict: VersionVerdict | null = null;
  let phone: { device: string; appVersion: string } | null = null;
  let helloSeen = false;

  function onHello(body: HelloBody, raw: Uint8Array): void {
    if (helloSeen) {
      core.fail();
      return;
    }
    helloSeen = true;
    const pairKey = lookup(body.pairingId);
    if (pairKey === null) {
      core.close("unknown-pairing");
      return;
    }
    pairingId = body.pairingId;
    const ephemeral = crypto.x25519KeyPair();
    verdict = judge({ version: body.v, min: body.min });
    const welcome: Frame = {
      type: "welcome",
      body: {
        v: local.version,
        min: local.min,
        eph: ephemeral.publicKey,
        nonce: crypto.randomBytes(16),
        verdict,
      },
    };
    const welcomeBytes = encodeFrame(welcome);
    send(welcomeBytes);
    if (verdict !== "ok") {
      core.close(verdict);
      return;
    }
    try {
      const keys = deriveSessionKeys(crypto, {
        pairKey,
        ownEphemeralSecret: ephemeral.secretKey,
        peerEphemeralPublic: body.eph,
        helloFrame: raw,
        welcomeFrame: welcomeBytes,
      });
      core.setKeys(keys.d2p, keys.p2d);
    } catch {
      core.close("handshake-failed");
    }
  }

  function onSealed(frame: Extract<Frame, { type: "sealed" }>): void {
    if (!core.hasKeys()) {
      core.fail();
      return;
    }
    const message = core.open(frame);
    if (message === null) return;
    if (core.state === "handshaking") {
      // The first authentic frame must be the session start, else the peer is not our phone app.
      const p = isRecord(message.p) ? message.p : null;
      if (
        message.ev !== "session.start" ||
        p === null ||
        typeof p.device !== "string" ||
        typeof p.appVersion !== "string"
      ) {
        core.close("protocol-error");
        return;
      }
      phone = { device: p.device, appVersion: p.appVersion };
      core.setOpen();
    }
    core.emit(message);
  }

  return {
    get state() {
      return core.api.state;
    },
    get failures() {
      return core.api.failures;
    },
    get closeReason() {
      return core.api.closeReason;
    },
    get pairingId() {
      return pairingId;
    },
    get verdict() {
      return verdict;
    },
    get phone() {
      return phone;
    },
    onMessage: core.api.onMessage,
    onState: core.api.onState,
    close: core.api.close,
    receive(raw) {
      if (core.state === "closed") return;
      const frame = decodeFrame(raw);
      if (frame === null) {
        core.fail();
      } else if (frame.type === "hello") {
        onHello(frame.body, raw);
      } else if (frame.type === "sealed") {
        onSealed(frame);
      } else {
        core.fail();
      }
    },
    sendMessage(message) {
      // Nothing leaves before the phone's first frame opened: until then the peer is unproven.
      if (core.state !== "open") return "not-open";
      const sealed = core.seal(message);
      if (sealed.frame !== undefined) send(sealed.frame);
      return sealed.result;
    },
  };
}
