/**
 * Protocol identification against real loopback servers on ephemeral ports.
 * TLS cases mint a throwaway CA with the `openssl` CLI and pass it to the probe
 * through its `ca` option only; nothing is trusted process-wide.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type TestContext,
} from "vitest";
import {
  createProber,
  identifyEndpoint,
  PROBE_BACKOFF_BASE_MS,
  PROBE_BACKOFF_MAX_MS,
  PROBE_MAX_CONCURRENT,
  PROBE_MAX_HEADER_BYTES,
  urlFor,
  type EndpointTarget,
  type IdentifyOptions,
  type IdentifyResult,
} from "./protocol";

const SHORT_DEADLINE_MS = 250;
const LOCAL_V4 = "127.0.0.1";
const LOCAL_V6 = "::1";
const CERT_DAYS = "2";
const HUGE_HEADER_BYTES = PROBE_MAX_HEADER_BYTES * 4;
const TLS_HANDSHAKE_RECORD = 0x16;
const STATUS_BAD_REQUEST = 400;

// ---------------------------------------------------------------- servers ---

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface Listening {
  readonly port: number;
  readonly sockets: Set<net.Socket>;
  readonly closed: Promise<void>;
}

function track(server: net.Server): Listening {
  const sockets = new Set<net.Socket>();
  let closeSeen: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    closeSeen = resolve;
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      sockets.delete(socket);
      closeSeen();
    });
  });
  closers.push(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  );
  return { port: 0, sockets, closed };
}

async function listen(server: net.Server, host: string): Promise<Listening> {
  const tracked = track(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  return { ...tracked, port: (server.address() as net.AddressInfo).port };
}

function httpServer(
  host: string,
  handler: http.RequestListener = (_req, res) => res.end(),
): Promise<Listening> {
  return listen(http.createServer(handler), host);
}

/** Accepts connections and runs `onData` for the first chunk, nothing else. */
function rawServer(host: string, onData: (socket: net.Socket) => void): Promise<Listening> {
  const server = net.createServer((socket) => socket.once("data", () => onData(socket)));
  return listen(server, host);
}

function target(port: number, address = LOCAL_V4): EndpointTarget {
  return { address, port, family: address.includes(":") ? "IPv6" : "IPv4" };
}

const quick: IdentifyOptions = { deadlineMs: SHORT_DEADLINE_MS };

async function canListen(host: string): Promise<boolean> {
  const server = net.createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(0, host, () => server.close(() => resolve(true)));
  });
}

const ipv6Available = await canListen(LOCAL_V6);
const IPV6_SKIP_REASON = "environment: IPv6 loopback (::1) is not available on this machine";

function skipWithoutIpv6(context: TestContext): void {
  if (!ipv6Available) {
    context.skip(IPV6_SKIP_REASON);
  }
}

// --------------------------------------------------------------- HTTP basics ---

describe("identifyEndpoint over plain HTTP", () => {
  it.each([200, 404, 405, 500])("treats status %i as http, not health", async (status) => {
    const server = await httpServer(LOCAL_V4, (_req, res) => res.writeHead(status).end());

    expect(await identifyEndpoint(target(server.port))).toEqual({ protocol: "http", status });
  });

  it(`identifies http on ::1 `, async (context) => {
    skipWithoutIpv6(context);
    const server = await httpServer(LOCAL_V6);

    expect(await identifyEndpoint(target(server.port, LOCAL_V6))).toEqual({
      protocol: "http",
      status: 200,
    });
  });

  it("sends only a bodyless HEAD / with no cookie or credential", async () => {
    const seen: http.IncomingMessage[] = [];
    const server = await httpServer(LOCAL_V4, (req, res) => {
      seen.push(req);
      res.end();
    });

    await identifyEndpoint(target(server.port));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("HEAD");
    expect(seen[0]?.url).toBe("/");
    expect(seen[0]?.headers.cookie).toBeUndefined();
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  it("does not follow a redirect", async () => {
    let requests = 0;
    const server = await httpServer(LOCAL_V4, (_req, res) => {
      requests += 1;
      res.writeHead(302, { Location: "http://127.0.0.1:1/elsewhere" }).end();
    });

    expect(await identifyEndpoint(target(server.port))).toEqual({ protocol: "http", status: 302 });
    expect(requests).toBe(1);
  });

  it("keeps a plain 400 as http", async () => {
    const server = await httpServer(LOCAL_V4, (_req, res) => res.writeHead(400).end());

    expect(await identifyEndpoint(target(server.port))).toEqual({ protocol: "http", status: 400 });
  });
});

describe("identifyEndpoint on endpoints that are not HTTP", () => {
  it("reports unknown for a TCP server that answers with garbage", async () => {
    const server = await rawServer(LOCAL_V4, (socket) => socket.end("SSH-2.0-fixture\r\n"));

    expect(await identifyEndpoint(target(server.port), quick)).toEqual({
      protocol: "unknown",
      error: "not-http",
    });
  });

  it("reports unknown for a TCP server that closes immediately", async () => {
    const server = await rawServer(LOCAL_V4, (socket) => socket.destroy());

    expect(await identifyEndpoint(target(server.port), quick)).toEqual({
      protocol: "unknown",
      error: "not-http",
    });
  });

  it("reports connection-failed when nothing listens", async () => {
    const server = await httpServer(LOCAL_V4);
    const { port } = server;
    await closers.pop()?.();

    expect(await identifyEndpoint(target(port), quick)).toEqual({
      protocol: "unknown",
      error: "connection-failed",
    });
  });

  it("aborts a response whose headers never finish at the deadline", async () => {
    const server = await rawServer(LOCAL_V4, (socket) => socket.write("HTTP/1.1 200 OK\r\n"));
    const started = Date.now();

    const result = await identifyEndpoint(target(server.port), quick);

    expect(result).toEqual({ protocol: "unknown", error: "timeout" });
    expect(Date.now() - started).toBeLessThan(SHORT_DEADLINE_MS * 8);
    await server.closed;
    expect(server.sockets.size).toBe(0);
  });

  it("aborts a silent server at the deadline and destroys the socket", async () => {
    const server = await rawServer(LOCAL_V4, () => undefined);

    expect(await identifyEndpoint(target(server.port), quick)).toEqual({
      protocol: "unknown",
      error: "timeout",
    });
    await server.closed;
  });

  it("stops after more than 16 KiB of headers", async () => {
    const server = await rawServer(LOCAL_V4, (socket) =>
      socket.write(`HTTP/1.1 200 OK\r\nX-Big: ${"a".repeat(HUGE_HEADER_BYTES)}\r\n\r\n`),
    );

    expect(await identifyEndpoint(target(server.port), quick)).toEqual({
      protocol: "unknown",
      error: "headers-too-large",
    });
    await server.closed;
  });
});

// ------------------------------------------------------------- cancellation ---

describe("identifyEndpoint cancellation", () => {
  it("resolves aborted and closes the socket when the signal fires", async () => {
    const server = await rawServer(LOCAL_V4, () => undefined);
    const controller = new AbortController();
    const pending = identifyEndpoint(target(server.port), {
      deadlineMs: 30_000,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    controller.abort();

    expect(await pending).toEqual({ protocol: "unknown", error: "aborted" });
    await server.closed;
  });

  it("makes no connection when the signal is already aborted", async () => {
    let connections = 0;
    const server = await listen(
      net.createServer(() => {
        connections += 1;
      }),
      LOCAL_V4,
    );

    const result = await identifyEndpoint(target(server.port), { signal: AbortSignal.abort() });

    expect(result).toEqual({ protocol: "unknown", error: "aborted" });
    expect(connections).toBe(0);
  });
});

// ------------------------------------------------------ addresses and URLs ---

describe("loopback mapping and URLs", () => {
  it("probes a wildcard 0.0.0.0 target through 127.0.0.1", async () => {
    const server = await httpServer("0.0.0.0");

    expect(await identifyEndpoint(target(server.port, "0.0.0.0"))).toEqual({
      protocol: "http",
      status: 200,
    });
  });

  it("probes a wildcard :: target through ::1", async (context) => {
    skipWithoutIpv6(context);
    const server = await httpServer("::");

    expect(await identifyEndpoint(target(server.port, "::"))).toEqual({
      protocol: "http",
      status: 200,
    });
  });

  it("never produces a URL with an unspecified address", () => {
    expect(urlFor(target(3000, "0.0.0.0"), "http")).toBe("http://127.0.0.1:3000/");
    expect(urlFor(target(3000, "::"), "https")).toBe("https://[::1]:3000/");
    expect(urlFor(target(3000, LOCAL_V6), "http")).toBe("http://[::1]:3000/");
    expect(urlFor(target(3000, "127.0.0.2"), "http")).toBe("http://127.0.0.2:3000/");
  });

  it("returns no URL for an unknown protocol or a bad target", () => {
    expect(urlFor(target(3000), "unknown")).toBeNull();
    expect(urlFor(target(3000, "192.168.1.20"), "http")).toBeNull();
    expect(urlFor({ address: "localhost", port: 3000, family: "IPv4" }, "http")).toBeNull();
    expect(urlFor(target(0), "http")).toBeNull();
    expect(urlFor({ address: "::1", port: 3000, family: "IPv4" }, "http")).toBeNull();
  });

  it("rejects non-loopback targets without connecting", async () => {
    expect(await identifyEndpoint(target(3000, "192.0.2.10"))).toEqual({
      protocol: "unknown",
      error: "non-loopback",
    });
    expect(await identifyEndpoint(target(3000, "2001:db8::1"))).toEqual({
      protocol: "unknown",
      error: "non-loopback",
    });
    expect(await identifyEndpoint(target(3000, "::ffff:127.0.0.1"))).toEqual({
      protocol: "unknown",
      error: "non-loopback",
    });
  });

  it("rejects hostnames instead of resolving them", async () => {
    const result = await identifyEndpoint({ address: "localhost", port: 3000, family: "IPv4" });

    expect(result).toEqual({ protocol: "unknown", error: "invalid-target" });
  });
});

// ---------------------------------------------------------------------- TLS ---

interface Fixtures {
  readonly ca: string;
  readonly trusted: { key: string; cert: string };
  readonly wrongName: { key: string; cert: string };
  readonly selfSigned: { key: string; cert: string };
}

function openssl(cwd: string, ...args: string[]): void {
  execFileSync("openssl", args, { cwd, stdio: "pipe" });
}

function opensslAvailable(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "pipe" });
    return true;
  } catch (_error) {
    return false;
  }
}

const EC_KEY = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];

function signedLeaf(dir: string, name: string, altNames: string): { key: string; cert: string } {
  writeFileSync(join(dir, `${name}.ext`), `subjectAltName=${altNames}\n`);
  openssl(
    dir,
    "req",
    ...EC_KEY,
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    `/CN=${name}`,
  );
  openssl(
    dir,
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    `${name}.pem`,
    "-days",
    CERT_DAYS,
    "-extfile",
    `${name}.ext`,
  );
  return {
    key: readFileSync(join(dir, `${name}.key`), "utf8"),
    cert: readFileSync(join(dir, `${name}.pem`), "utf8"),
  };
}

function buildFixtures(dir: string): Fixtures {
  openssl(
    dir,
    "req",
    "-x509",
    ...EC_KEY,
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-subj",
    "/CN=Deck Test CA",
    "-days",
    CERT_DAYS,
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign",
  );
  openssl(
    dir,
    "req",
    "-x509",
    ...EC_KEY,
    "-keyout",
    "self.key",
    "-out",
    "self.pem",
    "-subj",
    "/CN=self",
    "-days",
    CERT_DAYS,
    "-addext",
    "subjectAltName=IP:127.0.0.1,IP:::1",
  );
  return {
    ca: readFileSync(join(dir, "ca.pem"), "utf8"),
    trusted: signedLeaf(dir, "trusted", "IP:127.0.0.1,IP:::1"),
    wrongName: signedLeaf(dir, "wrongname", "DNS:example.test"),
    selfSigned: {
      key: readFileSync(join(dir, "self.key"), "utf8"),
      cert: readFileSync(join(dir, "self.pem"), "utf8"),
    },
  };
}

const OPENSSL_SKIP_REASON = "environment: the openssl CLI is not available";

describe("identifyEndpoint over TLS", () => {
  const hasOpenssl = opensslAvailable();
  let dir = "";
  let fixtures: Fixtures;

  beforeEach((context) => {
    if (!hasOpenssl) {
      context.skip(OPENSSL_SKIP_REASON);
    }
  });

  beforeAll(() => {
    if (!hasOpenssl) {
      return;
    }
    dir = mkdtempSync(join(tmpdir(), "deck-protocol-"));
    fixtures = buildFixtures(dir);
  });

  afterAll(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const httpsServer = (host: string, pair: { key: string; cert: string }, status = 200) =>
    listen(
      https.createServer(pair, (_req, res) => res.writeHead(status).end()),
      host,
    );

  it("identifies https when the certificate validates", async () => {
    const server = await httpsServer(LOCAL_V4, fixtures.trusted);

    expect(await identifyEndpoint(target(server.port), { ca: fixtures.ca })).toEqual({
      protocol: "https",
      status: 200,
    });
  });

  it("records an https error status without calling it health", async () => {
    const server = await httpsServer(LOCAL_V4, fixtures.trusted, 404);

    expect(await identifyEndpoint(target(server.port), { ca: fixtures.ca })).toEqual({
      protocol: "https",
      status: 404,
    });
  });

  it(`identifies https on ::1 `, async (context) => {
    skipWithoutIpv6(context);
    const server = await httpsServer(LOCAL_V6, fixtures.trusted);

    expect(await identifyEndpoint(target(server.port, LOCAL_V6), { ca: fixtures.ca })).toEqual({
      protocol: "https",
      status: 200,
    });
  });

  it("reports unknown with a tlsError for an untrusted certificate", async () => {
    const server = await httpsServer(LOCAL_V4, fixtures.selfSigned);

    const result = await identifyEndpoint(target(server.port), { ca: fixtures.ca });

    expect(result.protocol).toBe("unknown");
    expect(result.tlsError).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(result.status).toBeUndefined();
  });

  it.each([LOCAL_V4, LOCAL_V6])(
    "rejects a certificate without an IP SAN for %s",
    async (host, context) => {
      if (host === LOCAL_V6) skipWithoutIpv6(context);
      const server = await httpsServer(host, fixtures.wrongName);
      const result = await identifyEndpoint(target(server.port, host), { ca: fixtures.ca });
      expect(result).toEqual({ protocol: "unknown", tlsError: "ERR_TLS_CERT_ALTNAME_INVALID" });
    },
  );

  it("rejects a trusted certificate whose IP SAN covers a different loopback address", async () => {
    const wrongIp = signedLeaf(dir, "wrongip", "IP:127.0.0.2");
    const server = await httpsServer(LOCAL_V4, wrongIp);
    const result = await identifyEndpoint(target(server.port), { ca: fixtures.ca });
    expect(result).toEqual({ protocol: "unknown", tlsError: "ERR_TLS_CERT_ALTNAME_INVALID" });
  });

  it("does not trust the fixture CA unless the caller passes it", async () => {
    const server = await httpsServer(LOCAL_V4, fixtures.trusted);

    const result = await identifyEndpoint(target(server.port));

    expect(result.protocol).toBe("unknown");
    expect(result.tlsError).toBeDefined();
  });

  it("ignores NODE_TLS_REJECT_UNAUTHORIZED=0", async () => {
    const server = await httpsServer(LOCAL_V4, fixtures.selfSigned);
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      const result = await identifyEndpoint(target(server.port), { ca: fixtures.ca });

      expect(result.protocol).toBe("unknown");
      expect(result.tlsError).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
      }
    }
  });

  it("reports TLS-but-not-HTTP as unknown", async () => {
    const server = await listen(
      tls.createServer(fixtures.trusted, (socket) => socket.end("not http")),
      LOCAL_V4,
    );

    expect(
      await identifyEndpoint(target(server.port), {
        ca: fixtures.ca,
        deadlineMs: SHORT_DEADLINE_MS,
      }),
    ).toEqual({
      protocol: "unknown",
      error: "not-http",
    });
  });

  /** One port that answers plaintext with 400 (as nginx and Go do) and relays TLS
   * to a real HTTPS server. */
  async function mixedServer(pair: { key: string; cert: string }): Promise<Listening> {
    const secure = await listen(
      https.createServer(pair, (_req, res) => res.writeHead(200).end()),
      LOCAL_V4,
    );
    const server = net.createServer((socket) => {
      socket.once("data", (chunk) => {
        if (chunk[0] !== TLS_HANDSHAKE_RECORD) {
          socket.end(`HTTP/1.0 ${STATUS_BAD_REQUEST} Bad Request\r\n\r\n`);
          return;
        }
        const upstream = net.connect(secure.port, LOCAL_V4);
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
        upstream.write(chunk);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
    });
    return listen(server, LOCAL_V4);
  }

  it("upgrades a plaintext 400 to https when the TLS side validates", async () => {
    const server = await mixedServer(fixtures.trusted);

    expect(await identifyEndpoint(target(server.port), { ca: fixtures.ca })).toEqual({
      protocol: "https",
      status: 200,
    });
  });

  it("does not call a plaintext 400 verified http when the TLS side is untrusted", async () => {
    const server = await mixedServer(fixtures.selfSigned);

    const result = await identifyEndpoint(target(server.port), { ca: fixtures.ca });

    expect(result.protocol).toBe("unknown");
    expect(result.tlsError).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });
});

// ------------------------------------------------------------------- prober ---

interface Deferred {
  readonly options: IdentifyOptions;
  readonly target: EndpointTarget;
  resolve(result: IdentifyResult): void;
}

/** A probe stub whose calls stay pending until the test resolves them. */
function manualProbe() {
  const calls: Deferred[] = [];
  let active = 0;
  let peak = 0;
  const probe = (probeTarget: EndpointTarget, options: IdentifyOptions) =>
    new Promise<IdentifyResult>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      const finish = (result: IdentifyResult) => {
        active -= 1;
        resolve(result);
      };
      options.signal?.addEventListener(
        "abort",
        () => finish({ protocol: "unknown", error: "aborted" }),
        { once: true },
      );
      calls.push({ options, target: probeTarget, resolve: finish });
    });
  return { probe, calls, peak: () => peak };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const HTTP_OK: IdentifyResult = { protocol: "http", status: 200 };
const FAILED: IdentifyResult = { protocol: "unknown", error: "not-http" };

function request(key: string, identity = "pid-1", port = 3000) {
  return { key, identity, target: target(port) };
}

describe("createProber", () => {
  it("never runs more than the concurrency limit and drains the queue", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe });
    const total = PROBE_MAX_CONCURRENT + 2;
    const results = Array.from({ length: total }, (_unused, index) =>
      prober.identify(request(`k${index}`, "pid", 3000 + index)),
    );
    await tick();

    expect(stub.calls).toHaveLength(PROBE_MAX_CONCURRENT);
    for (let resolved = 0; resolved < total; resolved += 1) {
      stub.calls[resolved]?.resolve(HTTP_OK);
      await tick();
    }

    expect((await Promise.all(results)).every((result) => result.protocol === "http")).toBe(true);
    expect(stub.peak()).toBe(PROBE_MAX_CONCURRENT);
  });

  it("shares one in-flight probe between callers of the same instance", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe });
    const first = prober.identify(request("a"));
    const second = prober.identify(request("a"));
    await tick();

    expect(stub.calls).toHaveLength(1);
    stub.calls[0]?.resolve(HTTP_OK);

    expect(await first).toMatchObject({ protocol: "http", source: "probe" });
    expect(await second).toMatchObject({ protocol: "http", source: "probe" });
  });

  it("caches a successful protocol per instance", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe });
    const first = prober.identify(request("a"));
    await tick();
    stub.calls[0]?.resolve(HTTP_OK);
    await first;

    expect(await prober.identify(request("a"))).toMatchObject({
      protocol: "http",
      source: "cache",
    });
    expect(stub.calls).toHaveLength(1);
  });

  it("drops the cache and cancels the in-flight probe when the identity changes", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe });
    const cached = prober.identify(request("a", "pid-1"));
    await tick();
    stub.calls[0]?.resolve(HTTP_OK);
    await cached;

    const takeover = prober.identify(request("a", "pid-2"));
    await tick();
    expect(stub.calls).toHaveLength(2);
    const stale = prober.identify(request("a", "pid-3"));
    await tick();

    expect(stub.calls[1]?.options.signal?.aborted).toBe(true);
    expect(await takeover).toMatchObject({ error: "aborted" });
    stub.calls[2]?.resolve({ protocol: "https", status: 200 });
    expect(await stale).toMatchObject({ protocol: "https", source: "probe" });
    expect(await prober.identify(request("a", "pid-3"))).toMatchObject({
      protocol: "https",
      source: "cache",
    });
  });

  it("backs off failed probes with a doubling delay, driven by the injected clock", async () => {
    const stub = manualProbe();
    let clock = 0;
    const prober = createProber({ probe: stub.probe, now: () => clock });
    const fail = async () => {
      const pending = prober.identify(request("a"));
      await tick();
      stub.calls.at(-1)?.resolve(FAILED);
      return pending;
    };

    await fail();
    expect(await prober.identify(request("a"))).toMatchObject({
      error: "not-http",
      source: "backoff",
    });
    expect(stub.calls).toHaveLength(1);

    clock += PROBE_BACKOFF_BASE_MS;
    await fail();
    expect(stub.calls).toHaveLength(2);
    clock += PROBE_BACKOFF_BASE_MS;
    expect(await prober.identify(request("a"))).toMatchObject({ source: "backoff" });

    clock += PROBE_BACKOFF_BASE_MS;
    await fail();
    expect(stub.calls).toHaveLength(3);
  });

  it("caps the backoff delay", async () => {
    const stub = manualProbe();
    let clock = 0;
    const prober = createProber({ probe: stub.probe, now: () => clock });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const pending = prober.identify(request("a"));
      await tick();
      stub.calls.at(-1)?.resolve(FAILED);
      await pending;
      clock += PROBE_BACKOFF_MAX_MS;
    }

    expect(stub.calls).toHaveLength(12);
  });

  it("does not cache or back off a cancelled probe", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe });
    const controller = new AbortController();
    const cancelled = prober.identify(request("a"), controller.signal);
    await tick();
    controller.abort();

    expect(await cancelled).toMatchObject({ error: "aborted" });
    const retry = prober.identify(request("a"));
    await tick();
    expect(stub.calls).toHaveLength(2);
    stub.calls[1]?.resolve(HTTP_OK);
    expect(await retry).toMatchObject({ protocol: "http" });
  });

  it("keeps a shared probe alive until its last waiter leaves", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe });
    const first = new AbortController();
    const second = new AbortController();
    const one = prober.identify(request("a"), first.signal);
    const two = prober.identify(request("a"), second.signal);
    await tick();

    first.abort();
    expect(await one).toMatchObject({ error: "aborted" });
    expect(stub.calls[0]?.options.signal?.aborted).toBe(false);
    second.abort();
    expect(await two).toMatchObject({ error: "aborted" });
    expect(stub.calls[0]?.options.signal?.aborted).toBe(true);
  });

  it("skips a queued probe that was cancelled before it started", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe, maxConcurrent: 1 });
    const running = prober.identify(request("a"));
    const controller = new AbortController();
    const queued = prober.identify(request("b"), controller.signal);
    await tick();
    controller.abort();

    expect(await queued).toMatchObject({ error: "aborted" });
    stub.calls[0]?.resolve(HTTP_OK);
    await running;
    expect(stub.calls).toHaveLength(1);
  });

  it("forget drops cached state for an instance", async () => {
    const stub = manualProbe();
    const prober = createProber({ probe: stub.probe });
    const first = prober.identify(request("a"));
    await tick();
    stub.calls[0]?.resolve(HTTP_OK);
    await first;

    prober.forget("a");
    const again = prober.identify(request("a"));
    await tick();

    expect(stub.calls).toHaveLength(2);
    stub.calls[1]?.resolve(HTTP_OK);
    await again;
  });
});

describe("createProber with real sockets", () => {
  it("closes the connection when disposed mid-probe", async () => {
    const server = await rawServer(LOCAL_V4, () => undefined);
    const prober = createProber({ probeOptions: { deadlineMs: 30_000 } });
    const pending = prober.identify({ key: "a", identity: "pid", target: target(server.port) });
    await new Promise((resolve) => setTimeout(resolve, 50));

    prober.dispose();

    expect(await pending).toMatchObject({ protocol: "unknown", error: "aborted" });
    await server.closed;
    expect(
      await prober.identify({ key: "b", identity: "pid", target: target(server.port) }),
    ).toMatchObject({
      error: "aborted",
    });
  });

  it("identifies a real server once and serves the cache afterwards", async () => {
    let requests = 0;
    const server = await httpServer(LOCAL_V4, (_req, res) => {
      requests += 1;
      res.end();
    });
    const prober = createProber();
    const req = { key: "a", identity: "pid", target: target(server.port) };

    expect(await prober.identify(req)).toMatchObject({
      protocol: "http",
      status: 200,
      source: "probe",
    });
    expect(await prober.identify(req)).toMatchObject({ protocol: "http", source: "cache" });
    expect(requests).toBe(1);
  });
});
