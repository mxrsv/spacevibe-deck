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
  return { pairingId, sealed: typeof inner.c === "string" ? inner.c : null };
}

/** Looks up a pairing's push key; null for a pairing this phone does not have. */
export type PushKeyLookup = (pairingId: string) => Uint8Array | null;

export type TapRoute =
  | { readonly kind: "pane"; readonly desktopId: string; readonly paneId: number }
  | { readonly kind: "home" };

/**
 * Where a tapped notification goes (MOB23). Only a payload this app opened itself (`openPush` with the
 * pairing's key) can name a pane: any pane id in the notification's data or userInfo is ignored,
 * because a relay can write those. A pairing this phone does not have, or nothing decryptable, opens Home.
 */
export function routeTap(data: unknown, crypto: CryptoProvider, keyOf: PushKeyLookup): TapRoute {
  const push = extractPushData(data);
  if (push === null) return { kind: "home" };
  const key = keyOf(push.pairingId);
  if (key === null) return { kind: "home" };
  const opened = push.sealed === null ? null : openPush(crypto, key, push.sealed);
  if (opened !== null) return { kind: "pane", desktopId: push.pairingId, paneId: opened.paneId };
  return { kind: "home" };
}

export interface ForegroundCopy {
  readonly title: string;
  readonly body: string;
  readonly paneId: number;
  readonly pairingId: string;
  /** The sealed payload it came from, so a tap can open it again instead of trusting a pane id. */
  readonly sealed: string;
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
  return {
    title,
    body: opened.body,
    paneId: opened.paneId,
    pairingId: push.pairingId,
    sealed: push.sealed,
  };
}

/** Data of the local notification the app schedules with the real copy (no `c`, so it is never re-processed). */
export function localNotificationData(copy: ForegroundCopy): Record<string, unknown> {
  // The same envelope shape a push has: a tap opens `c` with the push key like any other.
  return { d: { p: copy.pairingId, c: copy.sealed } };
}
