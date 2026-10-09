/**
 * Protocol identification for a locally listening endpoint.
 *
 * The caller already knows a process listens on `address:port`; this module only
 * answers "does it speak HTTP, HTTPS, or neither?" without side effects:
 *
 *  - Only numeric loopback targets are probed. A wildcard bind (`0.0.0.0`, `::`)
 *    maps to the matching loopback address and is never turned into a URL.
 *    No hostname is ever resolved, so no DNS and no off-machine request exists.
 *  - The probe is one `HEAD /`: headers only, no redirect followed, no cookie or
 *    credential, aborted after 16 KiB of headers or one shared deadline.
 *  - Any valid HTTP status (404, 405, 500 …) proves the protocol, not health.
 *  - A plaintext failure is followed by an HTTPS probe with ordinary certificate
 *    validation. A certificate failure is a hint (`tlsError`), never "verified
 *    HTTP". `rejectUnauthorized` is always `true` on the request, which also
 *    overrides `NODE_TLS_REJECT_UNAUTHORIZED=0` for it.
 *
 * `createProber` adds the scheduling around it: bounded concurrency, one probe in
 * flight per instance, a cache of successful protocols and backoff for failures.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const PROBE_DEADLINE_MS = 1_000;
export const PROBE_MAX_HEADER_BYTES = 16 * 1_024;
export const PROBE_MAX_CONCURRENT = 4;
export const PROBE_BACKOFF_BASE_MS = 5_000;
export const PROBE_BACKOFF_MAX_MS = 60_000;

const MAX_PORT = 65_535;
const IPV4_LOOPBACK = "127.0.0.1";
const IPV4_WILDCARD = "0.0.0.0";
const IPV6_LOOPBACK = "::1";
const IPV6_LOOPBACK_URL_HOST = "[::1]";
const IPV6_WILDCARD_URL_HOST = "[::]";
/** Servers such as Go's net/http and nginx answer plaintext on a TLS port with a
 * 400 instead of dropping the connection, so a 400 alone does not prove HTTP. */
const PLAIN_HTTP_TO_TLS_STATUS = 400;

/** OpenSSL verification failures Node surfaces as `error.code` on the request. */
const CERT_ERROR_CODES: ReadonlySet<string> = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "EACCES",
]);

export type EndpointFamily = "IPv4" | "IPv6";
export interface EndpointTarget {
  readonly address: string;
  readonly port: number;
  readonly family: EndpointFamily;
}

export type Protocol = "http" | "https" | "unknown";
export type ProbeError =
  | "invalid-target"
  | "non-loopback"
  | "timeout"
  | "aborted"
  | "headers-too-large"
  | "not-http"
  | "connection-failed";

export interface IdentifyResult {
  readonly protocol: Protocol;
  /** HTTP status of the probe response. Says nothing about health. */
  readonly status?: number;
  /** Certificate failure code when the endpoint speaks TLS but is untrusted. */
  readonly tlsError?: string;
  readonly error?: ProbeError;
}

export interface IdentifyOptions {
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
  /** Extra trust roots. Production leaves this unset; tests pass a fixture CA. */
  readonly ca?: string | Buffer | ReadonlyArray<string | Buffer>;
}

type LoopbackHost = { ok: true; host: string } | { ok: false; error: ProbeError };

function ipv6Host(address: string): LoopbackHost {
  let host: string;
  try {
    host = new URL(`http://[${address}]/`).hostname;
  } catch (_error) {
    return { ok: false, error: "non-loopback" };
  }
  if (host === IPV6_LOOPBACK_URL_HOST || host === IPV6_WILDCARD_URL_HOST) {
    return { ok: true, host: IPV6_LOOPBACK };
  }
  return { ok: false, error: "non-loopback" };
}

function ipv4Host(address: string): LoopbackHost {
  if (address === IPV4_WILDCARD) {
    return { ok: true, host: IPV4_LOOPBACK };
  }
  return address.startsWith("127.")
    ? { ok: true, host: address }
    : { ok: false, error: "non-loopback" };
}

function resolveLoopbackHost(target: EndpointTarget): LoopbackHost {
  const version = net.isIP(target.address);
  const expected = target.family === "IPv4" ? 4 : 6;
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > MAX_PORT) {
    return { ok: false, error: "invalid-target" };
  }
  if (version === 0 || version !== expected) {
    return { ok: false, error: "invalid-target" };
  }
  return version === 4 ? ipv4Host(target.address) : ipv6Host(target.address);
}

/** Bare address as a URL / Host-header literal. */
const hostLiteral = (host: string): string => (host.includes(":") ? `[${host}]` : host);

/** The URL a browser may open for a known protocol, or null. Wildcard binds map
 * to loopback; a non-loopback, invalid or unidentified target has no URL. */
export function urlFor(target: EndpointTarget, protocol: Protocol): string | null {
  if (protocol === "unknown") {
    return null;
  }
  const resolved = resolveLoopbackHost(target);
  return resolved.ok ? `${protocol}://${hostLiteral(resolved.host)}:${target.port}/` : null;
}

type Attempt =
  | { kind: "response"; status: number }
  | { kind: "cert"; code: string }
  | { kind: "overflow" }
  | { kind: "unreachable" }
  | { kind: "rejected" }
  | { kind: "stopped" };

function errorCode(error: unknown): string {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return typeof code === "string" ? code : "";
}

function classifyError(error: unknown): Attempt {
  const code = errorCode(error);
  if (code === "HPE_HEADER_OVERFLOW") {
    return { kind: "overflow" };
  }
  if (CERT_ERROR_CODES.has(code)) {
    return { kind: "cert", code };
  }
  return UNREACHABLE_CODES.has(code) ? { kind: "unreachable" } : { kind: "rejected" };
}

interface Deadline {
  readonly signal: AbortSignal;
  cause(): "timeout" | "aborted";
  dispose(): void;
}

function createDeadline(ms: number, external: AbortSignal | undefined): Deadline {
  const controller = new AbortController();
  let cause: "timeout" | "aborted" | null = null;
  const stop = (why: "timeout" | "aborted") => {
    cause ??= why;
    controller.abort();
  };
  const onExternal = () => stop("aborted");
  const timer = setTimeout(() => stop("timeout"), ms);
  if (external?.aborted) {
    stop("aborted");
  }
  external?.addEventListener("abort", onExternal, { once: true });
  return {
    signal: controller.signal,
    cause: () => cause ?? "aborted",
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    },
  };
}

interface ProbeContext {
  readonly host: string;
  readonly port: number;
  readonly signal: AbortSignal;
  readonly ca: IdentifyOptions["ca"];
}

function requestOptions(context: ProbeContext): http.RequestOptions {
  return {
    host: context.host,
    port: context.port,
    method: "HEAD",
    path: "/",
    agent: false,
    maxHeaderSize: PROBE_MAX_HEADER_BYTES,
    headers: {
      Host: `${hostLiteral(context.host)}:${context.port}`,
      Accept: "*/*",
      Connection: "close",
    },
  };
}

function createRequest(scheme: "http" | "https", context: ProbeContext): http.ClientRequest {
  const options = requestOptions(context);
  if (scheme === "http") {
    return http.request(options);
  }
  return https.request({
    ...options,
    ca: context.ca as https.RequestOptions["ca"],
    rejectUnauthorized: true,
  });
}

/** One `HEAD /`. Always resolves; the socket is destroyed before it does. */
function headAttempt(scheme: "http" | "https", context: ProbeContext): Promise<Attempt> {
  return new Promise((resolve) => {
    if (context.signal.aborted) {
      resolve({ kind: "stopped" });
      return;
    }
    const request = createRequest(scheme, context);
    let settled = false;
    const finish = (attempt: Attempt) => {
      if (settled) {
        return;
      }
      settled = true;
      context.signal.removeEventListener("abort", onAbort);
      request.destroy();
      resolve(attempt);
    };
    const onAbort = () => finish({ kind: "stopped" });
    context.signal.addEventListener("abort", onAbort, { once: true });
    request.on("response", (response) =>
      finish({ kind: "response", status: response.statusCode ?? 0 }),
    );
    request.on("error", (error) => finish(classifyError(error)));
    request.end();
  });
}

function stopped(deadline: Deadline): IdentifyResult {
  return { protocol: "unknown", error: deadline.cause() };
}

function afterPlaintext(attempt: Attempt, deadline: Deadline): IdentifyResult {
  switch (attempt.kind) {
    case "overflow":
      return { protocol: "unknown", error: "headers-too-large" };
    case "unreachable":
      return { protocol: "unknown", error: "connection-failed" };
    default:
      return stopped(deadline);
  }
}

function afterTls(tls: Attempt, plaintext: Attempt, deadline: Deadline): IdentifyResult {
  switch (tls.kind) {
    case "response":
      return { protocol: "https", status: tls.status };
    case "cert":
      return { protocol: "unknown", tlsError: tls.code };
    case "stopped":
      return stopped(deadline);
    default:
      return plaintext.kind === "response"
        ? { protocol: "http", status: plaintext.status }
        : { protocol: "unknown", error: "not-http" };
  }
}

async function identify(context: ProbeContext, deadline: Deadline): Promise<IdentifyResult> {
  const plaintext = await headAttempt("http", context);
  if (plaintext.kind === "response" && plaintext.status !== PLAIN_HTTP_TO_TLS_STATUS) {
    return { protocol: "http", status: plaintext.status };
  }
  if (plaintext.kind !== "response" && plaintext.kind !== "rejected") {
    return afterPlaintext(plaintext, deadline);
  }
  return afterTls(await headAttempt("https", context), plaintext, deadline);
}

/** Identify the protocol behind a loopback endpoint. Never rejects. */
export async function identifyEndpoint(
  target: EndpointTarget,
  options: IdentifyOptions = {},
): Promise<IdentifyResult> {
  const resolved = resolveLoopbackHost(target);
  if (!resolved.ok) {
    return { protocol: "unknown", error: resolved.error };
  }
  const deadline = createDeadline(options.deadlineMs ?? PROBE_DEADLINE_MS, options.signal);
  try {
    const context = {
      host: resolved.host,
      port: target.port,
      signal: deadline.signal,
      ca: options.ca,
    };
    return await identify(context, deadline);
  } finally {
    deadline.dispose();
  }
}

export type ProbeFunction = (
  target: EndpointTarget,
  options: IdentifyOptions,
) => Promise<IdentifyResult>;

export interface ProbeRequest {
  /** Stable instance key; one probe is in flight per key. */
  readonly key: string;
  /** Opaque process-identity token. A different token under the same key discards
   * the cached protocol, the backoff and any in-flight probe. */
  readonly identity: string;
  readonly target: EndpointTarget;
}

export type ProberResult = IdentifyResult & { readonly source: "probe" | "cache" | "backoff" };

export interface ProberOptions {
  readonly maxConcurrent?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly now?: () => number;
  readonly probe?: ProbeFunction;
  readonly probeOptions?: Pick<IdentifyOptions, "deadlineMs" | "ca">;
}

export interface Prober {
  identify(request: ProbeRequest, signal?: AbortSignal): Promise<ProberResult>;
  /** Drop everything remembered for an instance that left the discovery set. */
  forget(key: string): void;
  /** Abort every probe and refuse new work. Sockets are destroyed by the abort. */
  dispose(): void;
}

interface Settled {
  readonly identity: string;
  readonly result: IdentifyResult;
  readonly failures: number;
  readonly retryAt: number;
}

interface Flight {
  readonly key: string;
  readonly identity: string;
  readonly controller: AbortController;
  readonly promise: Promise<IdentifyResult>;
  waiters: number;
}

const aborted = (): IdentifyResult => ({ protocol: "unknown", error: "aborted" });

function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  const acquire = (signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) {
      return Promise.resolve(false);
    }
    if (active < limit) {
      active += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const grant = () => {
        signal.removeEventListener("abort", skip);
        active += 1;
        resolve(true);
      };
      const skip = () => {
        const index = waiting.indexOf(grant);
        if (index >= 0) {
          waiting.splice(index, 1);
        }
        resolve(false);
      };
      waiting.push(grant);
      signal.addEventListener("abort", skip, { once: true });
    });
  };
  return async (signal: AbortSignal, task: () => Promise<IdentifyResult>) => {
    if (!(await acquire(signal))) {
      return aborted();
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function raceAbort(
  promise: Promise<IdentifyResult>,
  signal: AbortSignal | undefined,
): Promise<IdentifyResult> {
  if (!signal) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createProber(options: ProberOptions = {}): Prober {
  const now = options.now ?? Date.now;
  const probe = options.probe ?? identifyEndpoint;
  const backoffBase = options.backoffBaseMs ?? PROBE_BACKOFF_BASE_MS;
  const backoffMax = options.backoffMaxMs ?? PROBE_BACKOFF_MAX_MS;
  const limited = createLimiter(options.maxConcurrent ?? PROBE_MAX_CONCURRENT);
  const settled = new Map<string, Settled>();
  const flights = new Map<string, Flight>();
  let disposed = false;

  const commit = (request: ProbeRequest, result: IdentifyResult) => {
    const previous = settled.get(request.key);
    const failures = previous?.identity === request.identity ? previous.failures : 0;
    if (result.protocol !== "unknown") {
      settled.set(request.key, {
        identity: request.identity,
        result,
        failures: 0,
        retryAt: Infinity,
      });
      return;
    }
    const delay = Math.min(backoffBase * 2 ** failures, backoffMax);
    const retryAt = now() + delay;
    settled.set(request.key, {
      identity: request.identity,
      result,
      failures: failures + 1,
      retryAt,
    });
  };

  const known = (request: ProbeRequest): ProberResult | null => {
    const entry = settled.get(request.key);
    if (!entry || entry.identity !== request.identity) {
      settled.delete(request.key);
      return null;
    }
    if (entry.result.protocol !== "unknown") {
      return { ...entry.result, source: "cache" };
    }
    return now() < entry.retryAt ? { ...entry.result, source: "backoff" } : null;
  };

  const runFlight = async (request: ProbeRequest, controller: AbortController) => {
    const task = () =>
      probe(request.target, { ...options.probeOptions, signal: controller.signal });
    try {
      const result = await limited(controller.signal, task);
      if (!controller.signal.aborted && flights.get(request.key)?.controller === controller) {
        commit(request, result);
      }
      return result;
    } finally {
      if (flights.get(request.key)?.controller === controller) {
        flights.delete(request.key);
      }
    }
  };

  const startFlight = (request: ProbeRequest): Flight => {
    const controller = new AbortController();
    const flight: Flight = {
      key: request.key,
      identity: request.identity,
      controller,
      promise: runFlight(request, controller),
      waiters: 0,
    };
    flights.set(request.key, flight);
    return flight;
  };

  const joinFlight = (request: ProbeRequest): Flight => {
    const existing = flights.get(request.key);
    if (existing?.identity === request.identity) {
      return existing;
    }
    existing?.controller.abort();
    return startFlight(request);
  };

  const leave = (flight: Flight) => {
    flight.waiters -= 1;
    if (flight.waiters === 0 && flights.get(flight.key) === flight) {
      flights.delete(flight.key);
      flight.controller.abort();
    }
  };

  return {
    async identify(request, signal) {
      if (disposed || signal?.aborted) {
        return { ...aborted(), source: "probe" };
      }
      const cached = known(request);
      if (cached) {
        return cached;
      }
      const flight = joinFlight(request);
      flight.waiters += 1;
      try {
        return { ...(await raceAbort(flight.promise, signal)), source: "probe" };
      } finally {
        leave(flight);
      }
    },
    forget(key) {
      settled.delete(key);
      const flight = flights.get(key);
      flights.delete(key);
      flight?.controller.abort();
    },
    dispose() {
      disposed = true;
      for (const flight of flights.values()) {
        flight.controller.abort();
      }
      flights.clear();
      settled.clear();
    },
  };
}
