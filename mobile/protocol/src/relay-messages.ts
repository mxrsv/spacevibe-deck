/**
 * The relay's own control protocol (spec MOB6, MOB8): JSON **text** WebSocket messages between a
 * client and the relay. Peer traffic is **binary** and the relay forwards it without reading it
 * (`frames.ts`), so nothing here ever carries terminal text, file contents or notification copy.
 *
 * Every parser returns null for anything outside the shape, so the relay can treat a bad message
 * like a hostile one, and the clients can ignore a relay that speaks a newer dialect.
 */

export const RELAY_ROLES = ["desktop", "phone"] as const;
export type RelayRole = (typeof RELAY_ROLES)[number];

export const PUSH_KINDS = ["apns", "expo"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export const PUSH_ENVS = ["sandbox", "production"] as const;
export type PushEnv = (typeof PUSH_ENVS)[number];

/** Why the relay closed a socket, with the WebSocket close code it uses for each. */
export const RELAY_CLOSE = {
  "auth-timeout": 4400,
  unauthorized: 4401,
  unknown: 4404,
  expired: 4408,
  claimed: 4409,
  revoked: 4410,
  "too-large": 4413,
  "rate-limited": 4429,
  "too-many-sockets": 4430,
} as const;
export type RelayErrorCode = Exclude<keyof typeof RELAY_CLOSE, "revoked">;

/** What a phone shows for each close code (MOB8): the user can act on every one of them. */
export const RELAY_ERROR_TEXT: Readonly<Record<RelayErrorCode, string>> = {
  "auth-timeout": "The relay closed the connection before it was ready. Retrying.",
  unauthorized: "This desktop no longer knows this phone. Pair it again.",
  unknown: "This pairing is gone from the relay. Pair the desktop again.",
  expired: "The pairing code expired. Show a new one in Deck's Settings.",
  claimed: "That pairing code was already used. Show a new one in Deck's Settings.",
  "too-large": "A message was too large for the relay.",
  "rate-limited": "Too many messages in a short time. Retrying shortly.",
  "too-many-sockets": "This phone connected again from somewhere else.",
};

export type ClientToRelay =
  | { readonly t: "auth"; readonly role: RelayRole; readonly token: string }
  | { readonly t: "claim"; readonly claimToken: string; readonly phoneTokenHash: string }
  | {
      readonly t: "push-token";
      readonly kind: PushKind;
      readonly token: string;
      readonly env: PushEnv;
    }
  | { readonly t: "push"; readonly data: string }
  | { readonly t: "revoke" }
  | { readonly t: "ping" };

export type RelayToClient =
  | {
      readonly t: "ready";
      readonly role: RelayRole;
      readonly peerOnline: boolean;
      readonly peerLastSeen: number | null;
    }
  | { readonly t: "peer"; readonly online: boolean; readonly lastSeen: number | null }
  | { readonly t: "revoked" }
  | { readonly t: "error"; readonly code: RelayErrorCode }
  | { readonly t: "pong" };

/** The body of `POST /v1/pairings`. */
export interface PairingRegistration {
  readonly pairingId: string;
  readonly desktopTokenHash: string;
  readonly claimHash: string;
  readonly expiresAt: number;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
/** A pairing id is 16 random bytes in base64url. */
const PAIRING_ID = /^[A-Za-z0-9_-]{22}$/;
/** A token or a SHA-256 hash is 32 bytes in base64url. */
const KEY_32 = /^[A-Za-z0-9_-]{43}$/;
/** APNs tokens are hex; Expo tokens look like `ExponentPushToken[...]`. */
const PUSH_TOKEN = /^[A-Za-z0-9_\-[\]:.]{8,256}$/;

export function isPairingId(value: unknown): value is string {
  return typeof value === "string" && PAIRING_ID.test(value);
}

export function isKey32(value: unknown): value is string {
  return typeof value === "string" && KEY_32.test(value);
}

function oneOf<T extends string>(set: readonly T[], value: unknown): T | null {
  return typeof value === "string" ? (set.find((member) => member === value) ?? null) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** JSON text → object, or null; never throws. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

export function parseClientToRelay(text: string, maxPushChars: number): ClientToRelay | null {
  const message = parseJsonObject(text);
  if (message === null) return null;
  switch (message.t) {
    case "auth": {
      const role = oneOf(RELAY_ROLES, message.role);
      return role !== null && isKey32(message.token)
        ? { t: "auth", role, token: message.token }
        : null;
    }
    case "claim":
      return isKey32(message.claimToken) && isKey32(message.phoneTokenHash)
        ? { t: "claim", claimToken: message.claimToken, phoneTokenHash: message.phoneTokenHash }
        : null;
    case "push-token": {
      const kind = oneOf(PUSH_KINDS, message.kind);
      const env = oneOf(PUSH_ENVS, message.env);
      return kind !== null &&
        env !== null &&
        typeof message.token === "string" &&
        PUSH_TOKEN.test(message.token)
        ? { t: "push-token", kind, env, token: message.token }
        : null;
    }
    case "push":
      return typeof message.data === "string" &&
        message.data.length > 0 &&
        message.data.length <= maxPushChars &&
        B64URL.test(message.data)
        ? { t: "push", data: message.data }
        : null;
    case "revoke":
      return { t: "revoke" };
    case "ping":
      return { t: "ping" };
    default:
      return null;
  }
}

function lastSeen(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseRelayToClient(text: string): RelayToClient | null {
  const message = parseJsonObject(text);
  if (message === null) return null;
  switch (message.t) {
    case "ready": {
      const role = oneOf(RELAY_ROLES, message.role);
      const seen = lastSeen(message.peerLastSeen);
      return role !== null && typeof message.peerOnline === "boolean" && seen !== undefined
        ? { t: "ready", role, peerOnline: message.peerOnline, peerLastSeen: seen }
        : null;
    }
    case "peer": {
      const seen = lastSeen(message.lastSeen);
      return typeof message.online === "boolean" && seen !== undefined
        ? { t: "peer", online: message.online, lastSeen: seen }
        : null;
    }
    case "revoked":
      return { t: "revoked" };
    case "error": {
      const code = oneOf(
        Object.keys(RELAY_CLOSE).filter((key) => key !== "revoked") as RelayErrorCode[],
        message.code,
      );
      return code === null ? null : { t: "error", code };
    }
    case "pong":
      return { t: "pong" };
    default:
      return null;
  }
}

export function parsePairingRegistration(value: unknown): PairingRegistration | null {
  const body = record(value);
  if (body === null) return null;
  const { pairingId, desktopTokenHash, claimHash, expiresAt } = body;
  return isPairingId(pairingId) &&
    isKey32(desktopTokenHash) &&
    isKey32(claimHash) &&
    typeof expiresAt === "number" &&
    Number.isSafeInteger(expiresAt)
    ? { pairingId, desktopTokenHash, claimHash, expiresAt }
    : null;
}

/** The close code for an error, so both ends read the same number. */
export function closeCodeOf(code: RelayErrorCode | "revoked"): number {
  return RELAY_CLOSE[code];
}

/** The error a close code stands for, or null for a normal close. */
export function errorOfCloseCode(closeCode: number): RelayErrorCode | "revoked" | null {
  for (const [code, value] of Object.entries(RELAY_CLOSE)) {
    if (value === closeCode) return code as RelayErrorCode | "revoked";
  }
  return null;
}

const RELAY_URL = /^(https?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/;

/**
 * The scheme, host and path of a relay base URL, or null when it is not plain `http(s)://host/path`.
 * String parsing on purpose: React Native's `URL` cannot set a protocol or a path.
 */
export function parseRelayUrl(
  relayUrl: string,
): { readonly secure: boolean; readonly host: string; readonly path: string } | null {
  const match = RELAY_URL.exec(relayUrl.trim());
  if (match === null) return null;
  return {
    secure: match[1] === "https",
    host: match[2],
    path: (match[3] ?? "").replace(/\/+$/, ""),
  };
}

function relayUrlOrThrow(relayUrl: string): { secure: boolean; host: string; path: string } {
  const parsed = parseRelayUrl(relayUrl);
  if (parsed === null) throw new Error("The relay URL must be http(s)://host[/path]");
  return parsed;
}

/** Turns an http(s) relay base URL into the ws(s) URL of one pairing's socket. */
export function pairingSocketUrl(relayUrl: string, pairingId: string): string {
  const { secure, host, path } = relayUrlOrThrow(relayUrl);
  return `${secure ? "wss" : "ws"}://${host}${path}/v1/pairings/${pairingId}/socket`;
}

/** The URL `POST`ed to register a pairing. */
export function pairingRegistrationUrl(relayUrl: string): string {
  const { secure, host, path } = relayUrlOrThrow(relayUrl);
  return `${secure ? "https" : "http"}://${host}${path}/v1/pairings`;
}
