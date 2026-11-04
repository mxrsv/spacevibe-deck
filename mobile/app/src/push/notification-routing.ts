import type { CryptoProvider } from "@protocol/crypto";
import { openPush } from "@protocol/push";

/** The generic line the relay sends, and what stays if nothing can be decrypted. */
export const GENERIC_PUSH_TITLE = "SpaceVibe Deck";
export const GENERIC_PUSH_BODY = "An agent needs you";

/** What a notification's custom data carries, from either path (APNs `d`, Expo `data`, the extension's `userInfo`). */
export interface PushData {
  readonly pairingId: string;
  /** The sealed payload (`d.c`), when present. */
  readonly sealed: string | null;
  /** The pane id the extension (or our own local notification) already put in the data. */
  readonly paneId: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractPushData(data: unknown): PushData | null {
  const root = record(data);
  if (root === null) return null;
  // APNs puts `{ p, c }` under `d`; Expo's service puts it at the top of `data`.
  const inner = record(root.d) ?? root;
  const pairingId =
    typeof inner.p === "string"
      ? inner.p
      : typeof root.pairingId === "string"
        ? root.pairingId
        : null;
  if (pairingId === null || pairingId === "") return null;
  const paneId =
    typeof root.paneId === "number" && Number.isSafeInteger(root.paneId) && root.paneId >= 0
      ? root.paneId
      : null;
  return { pairingId, sealed: typeof inner.c === "string" ? inner.c : null, paneId };
}

/** Looks up a pairing's push key; null for a pairing this phone does not have. */
export type PushKeyLookup = (pairingId: string) => Uint8Array | null;

export type TapRoute =
  | { readonly kind: "pane"; readonly desktopId: string; readonly paneId: number }
  | { readonly kind: "home" };

/**
 * Where a tapped notification goes (MOB23). The sealed payload is the authority when it opens; the
 * pane id already in the data (written by the extension, which opened the same payload) is the
 * fallback; a pairing this phone does not have, or nothing decryptable, opens Home.
 */
export function routeTap(data: unknown, crypto: CryptoProvider, keyOf: PushKeyLookup): TapRoute {
  const push = extractPushData(data);
  if (push === null) return { kind: "home" };
  const key = keyOf(push.pairingId);
  if (key === null) return { kind: "home" };
  const opened = push.sealed === null ? null : openPush(crypto, key, push.sealed);
  if (opened !== null) return { kind: "pane", desktopId: push.pairingId, paneId: opened.paneId };
  if (push.paneId !== null) return { kind: "pane", desktopId: push.pairingId, paneId: push.paneId };
  return { kind: "home" };
}

export interface ForegroundCopy {
  readonly title: string;
  readonly body: string;
  readonly paneId: number;
  readonly pairingId: string;
}

/**
 * The real copy of a push that arrived while the app is open without the extension (Expo Go), or
 * null when it cannot be opened: the generic line then stands, and nothing forged is shown.
 */
export function foregroundCopy(
  data: unknown,
  crypto: CryptoProvider,
  keyOf: PushKeyLookup,
): ForegroundCopy | null {
  const push = extractPushData(data);
  if (push === null || push.sealed === null) return null;
  const key = keyOf(push.pairingId);
  if (key === null) return null;
  const opened = openPush(crypto, key, push.sealed);
  if (opened === null) return null;
  const title = opened.desktop === "" ? opened.title : `${opened.title} · ${opened.desktop}`;
  return { title, body: opened.body, paneId: opened.paneId, pairingId: push.pairingId };
}

/** Data of the local notification the app schedules with the real copy (no `c`, so it is never re-processed). */
export function localNotificationData(copy: ForegroundCopy): Record<string, unknown> {
  return { pairingId: copy.pairingId, paneId: copy.paneId };
}
