import { RELAY_REGISTER_MAX_AHEAD_MS } from "../../protocol/src/limits";
import { isPairingId, parsePairingRegistration } from "../../protocol/src/relay-messages";
import { PROTOCOL_VERSION } from "../../protocol/src/version";
import type { Env } from "./env";

export { PairingRoom } from "./pairing-room";

/** A registration is four short strings and a number; anything bigger is not one. */
const MAX_BODY_BYTES = 4 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** The body as text, or null when it is longer than `max` bytes. Stops reading at the limit. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function registerPairing(request: Request, env: Env): Promise<Response> {
  // The address is only a rate-limit key: it is handed to the binding and never stored or logged.
  const client = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (
    env.REGISTER_LIMITER !== undefined &&
    !(await env.REGISTER_LIMITER.limit({ key: client })).success
  ) {
    return json({ error: "rate-limited" }, 429);
  }
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return json({ error: "too-large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const registration = parsePairingRegistration(body);
  const now = Date.now();
  if (
    registration === null ||
    registration.expiresAt <= now ||
    registration.expiresAt > now + RELAY_REGISTER_MAX_AHEAD_MS
  ) {
    return json({ error: "invalid" }, 400);
  }
  const room = env.PAIRINGS.get(env.PAIRINGS.idFromName(registration.pairingId));
  const response = await room.fetch("https://pairing.internal/register", {
    method: "POST",
    body: JSON.stringify(registration),
  });
  return json(await response.json(), response.status);
}

function openSocket(request: Request, env: Env, pairingId: string): Promise<Response> | Response {
  if (!isPairingId(pairingId)) return json({ error: "not-found" }, 404);
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "upgrade-required" }, 426);
  }
  const room = env.PAIRINGS.get(env.PAIRINGS.idFromName(pairingId));
  return room.fetch(new Request("https://pairing.internal/socket", request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Routed at `api.deck.spacevibe.dev/relay/*`; `wrangler dev` serves the same paths at `/`.
    const path = url.pathname.replace(/^\/relay(?=\/|$)/, "");
    if (request.method === "GET" && path === "/v1/health") {
      return json({ ok: true, protocol: PROTOCOL_VERSION });
    }
    if (request.method === "POST" && path === "/v1/pairings") {
      return registerPairing(request, env);
    }
    const socket = /^\/v1\/pairings\/([^/]+)\/socket$/.exec(path);
    if (request.method === "GET" && socket !== null) return openSocket(request, env, socket[1]);
    return json({ error: "not-found" }, 404);
  },
} satisfies ExportedHandler<Env>;
