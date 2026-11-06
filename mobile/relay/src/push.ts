import type { PushEnv, PushKind } from "../../protocol/src/relay-messages";
import type { Env } from "./env";
import { b64urlEncode } from "./token-hash";

/** What the phone may read of a notification before it opens the sealed copy (spec MOB22). */
export const PUSH_TITLE = "SpaceVibe Deck";
export const PUSH_BODY = "An agent needs you";

const APNS_HOSTS: Readonly<Record<PushEnv, string>> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
const APNS_DEVICE_TOKEN = /^[0-9a-fA-F]{32,200}$/;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** APNs accepts a provider token for an hour and wants it refreshed no more than every 20 min. */
const JWT_REUSE_MS = 50 * 60_000;

export interface PushTarget {
  readonly kind: PushKind;
  readonly token: string;
  readonly env: PushEnv;
}

/**
 * `unregistered` is the one outcome the caller acts on: the device token is dead, so the relay
 * forgets it instead of retrying a push that can never arrive.
 */
export type PushOutcome = "sent" | "skipped" | "failed" | "unregistered";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

interface CachedJwt {
  readonly id: string;
  readonly jwt: string;
  readonly issuedAt: number;
}
let cachedJwt: CachedJwt | null = null;

/** Forget the cached provider token, e.g. after APNs said it expired. Also used by tests. */
export function resetPushCache(): void {
  cachedJwt = null;
}

function pemToPkcs8(pem: string): Uint8Array {
  // `wrangler secret put` keeps whatever was pasted, including a literal backslash-n for a newline.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

async function providerToken(
  key: string,
  keyId: string,
  teamId: string,
  now: number,
): Promise<string> {
  const id = `${keyId}:${teamId}`;
  if (cachedJwt !== null && cachedJwt.id === id && now - cachedJwt.issuedAt < JWT_REUSE_MS) {
    return cachedJwt.jwt;
  }
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(key),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  const part = (value: object) => b64urlEncode(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ alg: "ES256", kid: keyId })}.${part({
    iss: teamId,
    iat: Math.floor(now / 1000),
  })}`;
  // WebCrypto's ECDSA output is already the raw r||s form a JWT wants.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    encoder.encode(unsigned),
  );
  const jwt = `${unsigned}.${b64urlEncode(new Uint8Array(signature))}`;
  cachedJwt = { id, jwt, issuedAt: now };
  return jwt;
}

async function sendApns(
  env: Env,
  target: PushTarget,
  pairingId: string,
  data: string,
  doFetch: Fetcher,
): Promise<PushOutcome> {
  const { APNS_KEY_P8: key, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId } = env;
  if (!key || !keyId || !teamId) return "skipped";
  // The protocol parser accepts Expo-shaped tokens too; an APNs one is hex, and it goes in a path.
  if (!APNS_DEVICE_TOKEN.test(target.token)) return "failed";
  let jwt: string;
  try {
    jwt = await providerToken(key, keyId, teamId, Date.now());
  } catch {
    return "failed";
  }
  const response = await doFetch(`${APNS_HOSTS[target.env]}/3/device/${target.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": env.APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      // One slot per pairing: a newer "needs you" replaces the one still on the lock screen.
      "apns-collapse-id": pairingId,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: PUSH_TITLE, body: PUSH_BODY },
        "mutable-content": 1,
        sound: "default",
        "thread-id": pairingId,
      },
      d: { p: pairingId, c: data },
    }),
  });
  if (response.status === 200) return "sent";
  if (response.status === 410) return "unregistered";
  if (response.status === 403) cachedJwt = null;
  return "failed";
}

async function sendExpo(
  target: PushTarget,
  pairingId: string,
  data: string,
  doFetch: Fetcher,
): Promise<PushOutcome> {
  const response = await doFetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      to: target.token,
      title: PUSH_TITLE,
      body: PUSH_BODY,
      sound: "default",
      priority: "high",
      mutableContent: true,
      data: { p: pairingId, c: data },
    }),
  });
  if (!response.ok) return "failed";
  // Expo answers 200 even for a dead token; the verdict is in the body.
  try {
    const result = (await response.json()) as {
      data?: { status?: string; details?: { error?: string } };
    };
    if (result.data?.details?.error === "DeviceNotRegistered") return "unregistered";
    return result.data?.status === "error" ? "failed" : "sent";
  } catch {
    return "failed";
  }
}

/**
 * Asks Apple (or Expo, for Expo Go) to wake the phone. `data` is the sealed push and rides inside
 * the payload untouched: the visible text is always the generic line above, and only the phone
 * can turn `data` into the real notification. Never throws, never logs.
 */
export async function sendPush(
  env: Env,
  target: PushTarget,
  pairingId: string,
  data: string,
  doFetch: Fetcher = fetch,
): Promise<PushOutcome> {
  try {
    return target.kind === "apns"
      ? await sendApns(env, target, pairingId, data, doFetch)
      : await sendExpo(target, pairingId, data, doFetch);
  } catch {
    return "failed";
  }
}
