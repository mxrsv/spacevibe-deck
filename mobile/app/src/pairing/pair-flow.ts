import type { CryptoProvider } from "@protocol/crypto";
import { b64urlEncode } from "@protocol/encoding";
import { derivePushKey, deriveClaimToken } from "@protocol/keys";
import { createPairHello, openPairAccept, type PhoneInfo } from "@protocol/pairing";
import { parsePairingQr, type PairingQr, type QrFailure } from "@protocol/qr";
import {
  errorOfCloseCode,
  pairingSocketUrl,
  parseRelayToClient,
  RELAY_ERROR_TEXT,
  type ClientToRelay,
  type RelayErrorCode,
} from "@protocol/relay-messages";
import type { PairRejectReason } from "@protocol/frames";
import { CLOSE_NORMAL, type SocketFactory } from "@/session/socket";
import { osOf, type StoredPairing } from "./pairing-store";

/** How long each stage may take before the user is told what to try (design §3.4–3.6). */
export const PAIR_TIMEOUTS = { relayMs: 10_000, desktopMs: 20_000 } as const;

export type PairError =
  | { readonly kind: "qr"; readonly reason: QrFailure }
  | { readonly kind: "relay"; readonly code: RelayErrorCode }
  | { readonly kind: "rejected"; readonly reason: PairRejectReason | "malformed" }
  | { readonly kind: "relay-timeout" }
  | { readonly kind: "desktop-timeout" }
  | { readonly kind: "network" };

export type PairResult =
  | { readonly ok: true; readonly pairing: StoredPairing }
  | { readonly ok: false; readonly error: PairError };

const QR_TEXT: Record<QrFailure, string> = {
  "not-deck": "That is not a Deck pairing code. Scan the code in Deck's Settings → Mobile.",
  malformed: "That pairing code is damaged. Show a new one in Deck's Settings → Mobile.",
  "unsupported-version":
    "This pairing code is from a newer Deck. Update this app from TestFlight or the App Store.",
  expired: "The pairing code expired. Show a new one in Deck's Settings → Mobile.",
};

const REJECT_TEXT: Record<PairRejectReason | "malformed", string> = {
  expired: "The pairing code expired. Show a new one in Deck's Settings → Mobile.",
  used: "That pairing code was already used. Show a new one in Deck's Settings → Mobile.",
  unknown: "Deck is no longer waiting for this code. Show a new one in Deck's Settings → Mobile.",
  "bad-proof": "Deck could not verify this phone. Show a new code and scan it again.",
  malformed: "Deck sent an answer this app cannot read. Update both and try again.",
};

/** The sentence the pairing screen shows for each way pairing can fail (MOB8: every one is actionable). */
export function pairErrorText(error: PairError): string {
  switch (error.kind) {
    case "qr":
      return QR_TEXT[error.reason];
    case "relay":
      return RELAY_ERROR_TEXT[error.code];
    case "rejected":
      return REJECT_TEXT[error.reason];
    case "relay-timeout":
      return "Could not reach the relay. Check this phone's connection and try again.";
    case "desktop-timeout":
      return "Deck did not answer. Make sure Deck is running on your computer and still showing the code.";
    case "network":
      return "The connection dropped while pairing. Try again.";
  }
}

export interface PairDeps {
  readonly crypto: CryptoProvider;
  readonly socketFactory: SocketFactory;
  readonly now: () => number;
  readonly phone: PhoneInfo;
}

/** Parses a scanned or pasted code, rejecting an expired one before any network call. */
export function readPairingCode(
  text: string,
  now: number,
): { ok: true; qr: PairingQr } | { ok: false; error: PairError } {
  const parsed = parsePairingQr(text, now);
  return parsed.ok
    ? { ok: true, qr: parsed.value }
    : { ok: false, error: { kind: "qr", reason: parsed.reason } };
}

/**
 * Claims the pairing at the relay, proves to the desktop that this phone saw the QR, and waits for
 * its answer. The returned record is not stored here: the caller saves it, so a failed write is
 * the caller's to report.
 */
export function pairWithDesktop(deps: PairDeps, qr: PairingQr): Promise<PairResult> {
  const { crypto } = deps;
  return new Promise((resolve) => {
    let settled = false;
    let helloSent = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const phoneToken = crypto.randomBytes(32);
    const attempt = createPairHello(crypto, qr, deps.phone);
    const claim: ClientToRelay = {
      t: "claim",
      claimToken: b64urlEncode(deriveClaimToken(crypto, qr.secret)),
      phoneTokenHash: b64urlEncode(crypto.sha256(phoneToken)),
    };

    const settle = (result: PairResult, closeCode: number | null = CLOSE_NORMAL): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (closeCode !== null) socket.close(closeCode, "pairing-finished");
      resolve(result);
    };
    const fail = (error: PairError): void => settle({ ok: false, error });
    const arm = (ms: number, error: PairError): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => fail(error), ms);
    };
    const sendHello = (): void => {
      if (helloSent) return;
      helloSent = true;
      socket.send(attempt.frame);
      arm(PAIR_TIMEOUTS.desktopMs, { kind: "desktop-timeout" });
    };

    const socket = deps.socketFactory(pairingSocketUrl(qr.relayUrl, qr.pairingId), {
      onOpen() {
        socket.send(JSON.stringify(claim));
      },
      onText(text) {
        const message = parseRelayToClient(text);
        if (message === null) return;
        if (message.t === "error") return fail({ kind: "relay", code: message.code });
        // The desktop registers the pairing and then connects; until it is present a hello would
        // be dropped, so wait for presence instead of timing the send.
        if (message.t === "ready" && message.peerOnline) sendHello();
        if (message.t === "peer" && message.online) sendHello();
        if (message.t === "ready" && !message.peerOnline) {
          arm(PAIR_TIMEOUTS.desktopMs, { kind: "desktop-timeout" });
        }
      },
      onBinary(bytes) {
        if (!helloSent) return;
        const answer = openPairAccept(crypto, attempt, bytes);
        if (!answer.ok) return fail({ kind: "rejected", reason: answer.reason });
        const pairKey = attempt.pairKey;
        settle({
          ok: true,
          pairing: {
            pairingId: qr.pairingId,
            relayUrl: qr.relayUrl,
            desktopName: answer.desktop.name,
            os: osOf(answer.desktop.os),
            pairedAt: deps.now(),
            psk: b64urlEncode(attempt.phoneSecretKey),
            dpk: b64urlEncode(qr.desktopPublicKey),
            pairKey: b64urlEncode(pairKey),
            pushKey: b64urlEncode(derivePushKey(crypto, pairKey)),
            phoneToken: b64urlEncode(phoneToken),
          },
        });
      },
      onClose(code) {
        if (settled) return;
        const named = errorOfCloseCode(code);
        if (named !== null && named !== "revoked") fail({ kind: "relay", code: named });
        else fail({ kind: helloSent ? "network" : "relay-timeout" });
      },
    });
    arm(PAIR_TIMEOUTS.relayMs, { kind: "relay-timeout" });
  });
}
