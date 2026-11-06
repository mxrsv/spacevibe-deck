// Shared by the *.test.mjs files: builds the Worker the way `wrangler deploy` would, runs it in
// Miniflare (workerd), and gives tests a WebSocket client that records what the relay sends.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const SRC = fileURLToPath(new URL(".", import.meta.url));

export const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
export const sha256b64 = (bytes) => b64url(createHash("sha256").update(bytes).digest());

// Test-only wrapper: re-exports the real Worker and adds a way to read what a Durable Object has
// stored (and which attachments its sockets carry), which the canary test needs.
const WRAPPER = `
import worker, { PairingRoom as Room } from "./index.ts";
export class PairingRoom extends Room {
  async fetch(request) {
    if (new URL(request.url).pathname === "/__dump") {
      const stored = Object.fromEntries(await this.ctx.storage.list());
      const attachments = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment());
      return Response.json({ stored, attachments, alarm: await this.ctx.storage.getAlarm() });
    }
    return super.fetch(request);
  }
}
export default {
  fetch(request, env) {
    const dump = /^\\/__dump\\/(.+)$/.exec(new URL(request.url).pathname);
    if (dump) {
      return env.PAIRINGS.get(env.PAIRINGS.idFromName(dump[1])).fetch("https://x/__dump");
    }
    return worker.fetch(request, env);
  },
};
`;

export async function startRelay({ bindings = {}, outboundService, ratelimits } = {}) {
  const bundle = await build({
    stdin: { contents: WRAPPER, resolveDir: SRC, loader: "js", sourcefile: "wrapper.js" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers"],
  });
  const logs = [];
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30",
    durableObjects: { PAIRINGS: { className: "PairingRoom", useSQLite: true } },
    bindings: { APNS_TOPIC: "dev.spacevibe.deck.mobile", ...bindings },
    outboundService,
    ratelimits,
    handleRuntimeStdio(stdout, stderr) {
      for (const stream of [stdout, stderr]) stream.on("data", (chunk) => logs.push(String(chunk)));
    },
  });
  const origin = (await mf.ready).origin;
  return {
    mf,
    logs,
    origin,
    wsOrigin: origin.replace("http", "ws"),
    dispose: () => mf.dispose(),
    async dump(pairingId) {
      return (await mf.dispatchFetch(`${origin}/__dump/${pairingId}`)).json();
    },
    post: (path, body, init = {}) =>
      mf.dispatchFetch(`${origin}${path}`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        ...init,
      }),
  };
}

/** A pairing's secrets, the way the desktop and phone would derive them. */
export function makePairing(expiresInMs = 5 * 60_000) {
  const desktopToken = randomBytes(32);
  const claimToken = randomBytes(32);
  const phoneToken = randomBytes(32);
  return {
    pairingId: b64url(randomBytes(16)),
    desktopToken: b64url(desktopToken),
    claimToken: b64url(claimToken),
    phoneToken: b64url(phoneToken),
    phoneTokenHash: sha256b64(phoneToken),
    registration(extra = {}) {
      return {
        pairingId: this.pairingId,
        desktopTokenHash: sha256b64(desktopToken),
        claimHash: sha256b64(claimToken),
        expiresAt: Date.now() + expiresInMs,
        ...extra,
      };
    },
  };
}

export async function register(relay, pairing, extra) {
  const response = await relay.post("/v1/pairings", pairing.registration(extra));
  await response.arrayBuffer();
  return response.status;
}

/** Node's WebSocket client with a queue of what arrived and the close code. */
export class Client {
  constructor(url) {
    this.items = [];
    this.waiters = [];
    this.closeCode = null;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const item =
        typeof event.data === "string"
          ? { text: JSON.parse(event.data) }
          : { binary: new Uint8Array(event.data) };
      const waiter = this.waiters.shift();
      if (waiter) waiter(item);
      else this.items.push(item);
    });
    this.ws.addEventListener("close", (event) => {
      this.closeCode = event.code;
      this.resolveClosed(event.code);
    });
  }

  /** The next message, or throws after `timeoutMs`. */
  next(timeoutMs = 3000) {
    if (this.items.length > 0) return Promise.resolve(this.items.shift());
    return new Promise((resolve, reject) => {
      const waiter = (item) => {
        clearTimeout(timer);
        resolve(item);
      };
      const timer = setTimeout(() => {
        // A timed-out waiter must not swallow the next message.
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error("timed out waiting for a message"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async nextText(timeoutMs) {
    const item = await this.next(timeoutMs);
    if (!item.text) throw new Error("expected a text message");
    return item.text;
  }

  async nextBinary(timeoutMs) {
    const item = await this.next(timeoutMs);
    if (!item.binary) throw new Error("expected a binary message");
    return item.binary;
  }

  /** True when nothing arrives within `ms`. */
  async quiet(ms = 250) {
    try {
      await this.next(ms);
      return false;
    } catch {
      return true;
    }
  }

  sendText(message) {
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  sendBinary(bytes) {
    this.ws.send(bytes);
  }

  close() {
    this.ws.close();
  }
}

export async function connect(relay, pairingId) {
  const client = new Client(`${relay.wsOrigin}/v1/pairings/${pairingId}/socket`);
  await client.opened;
  return client;
}

/** Connects, authenticates and returns the client after its `ready`. */
export async function connectAs(relay, pairing, role) {
  const client = await connect(relay, pairing.pairingId);
  client.sendText({
    t: "auth",
    role,
    token: role === "desktop" ? pairing.desktopToken : pairing.phoneToken,
  });
  const ready = await client.nextText();
  if (ready.t !== "ready") throw new Error(`expected ready, got ${JSON.stringify(ready)}`);
  return { client, ready };
}

/** Claims as the phone; returns the client after its `ready`. */
export async function claimAs(relay, pairing) {
  const client = await connect(relay, pairing.pairingId);
  client.sendText({
    t: "claim",
    claimToken: pairing.claimToken,
    phoneTokenHash: pairing.phoneTokenHash,
  });
  const ready = await client.nextText();
  return { client, ready };
}

export function es256Key() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    pem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey,
  };
}
