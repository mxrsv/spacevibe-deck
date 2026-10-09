/**
 * Dev server discovery — the renderer's facade over the four `dev_servers_*` commands.
 *
 * Two jobs beyond forwarding. First, host detection: the Electron preload is the only place
 * that sets `window.__deckHost` (see `worktree-host.ts`), so its absence means Tauri or the
 * browser preview. There the facade answers "unsupported-host" locally without calling IPC,
 * which keeps "unavailable" distinct from "available but empty". Second, every reply is
 * validated before it reaches a caller: a malformed payload throws
 * `DevServerResponseError` and never becomes signal state.
 *
 * Payloads are flat object literals per R6 so `scripts/electron-ipc-contract.test.ts` can
 * compare their keys with the main-side handler.
 */
import { invoke } from "./bridge";
import type {
  DevServerBinding,
  DevServerCapability,
  DevServerDiagnostic,
  DevServerHost,
  DevServerResolveResult,
  DevServerRootDiagnostic,
  DevServerRootsReply,
  DevServerRow,
  DevServerSnapshot,
  ScanCompleteness,
} from "../dev-servers/dev-server-types";

const MAX_REPLY_ITEMS = 1_000;
const MAX_PORT = 65_535;
const COMPLETENESS: readonly string[] = ["complete", "partial", "failed"];
const COMPLETENESS_OR_PENDING: readonly string[] = [...COMPLETENESS, "pending"];
const LIVENESS: readonly string[] = ["running", "stopped", "unknown"];
const PROTOCOLS: readonly string[] = ["http", "https", "unknown"];
const FAMILIES: readonly string[] = ["IPv4", "IPv6"];
const ROOT_DIAGNOSTIC_CODES: readonly string[] = [
  "invalid",
  "not-found",
  "unreadable",
  "over-limit",
];
const UNAVAILABLE_REASONS: readonly string[] = [
  "unsupported-platform",
  "observation-stopped",
  "not-running",
  "scan-incomplete",
];
const WEB_PROTOCOLS: readonly string[] = ["http", "https"];

export const UNSUPPORTED_HOST: DevServerCapability = {
  available: false,
  reason: "unsupported-host",
};

/** A host reply that does not match the contract. Carries what was wrong, never the payload. */
export class DevServerResponseError extends Error {
  constructor(detail: string) {
    super(`Invalid dev server reply: ${detail}`);
    this.name = "DevServerResponseError";
  }
}

/** Read per call, not at import: the bridge can appear after module load in tests. */
export function devServerHostPresent(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __deckHost?: unknown }).__deckHost !== undefined
  );
}

type Fields = Record<string, unknown>;

function fail(detail: string): never {
  throw new DevServerResponseError(detail);
}

function asRecord(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(`${what} is not an object`);
  }
  return value as Fields;
}

function str(fields: Fields, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : fail(`${key} is not a string`);
}

function bool(fields: Fields, key: string): boolean {
  const value = fields[key];
  return typeof value === "boolean" ? value : fail(`${key} is not a boolean`);
}

function count(fields: Fields, key: string): number {
  const value = fields[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(`${key} is not a non-negative integer`);
}

function timestamp(fields: Fields, key: string): number {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fail(`${key} is not a timestamp`);
}

function nullable<T>(fields: Fields, key: string, read: (f: Fields, k: string) => T): T | null {
  return fields[key] === null ? null : read(fields, key);
}

function oneOf<T extends string>(fields: Fields, key: string, allowed: readonly string[]): T {
  const value = str(fields, key);
  return allowed.includes(value) ? (value as T) : fail(`${key} is not a known value`);
}

function list<T>(fields: Fields, key: string, read: (item: unknown) => T): T[] {
  const value = fields[key];
  if (!Array.isArray(value)) {
    return fail(`${key} is not an array`);
  }
  if (value.length > MAX_REPLY_ITEMS) {
    return fail(`${key} has too many items`);
  }
  return value.map(read);
}

/** Only http(s) URLs may reach a caller that will hand them to a browser. */
function webUrl(value: string): string {
  try {
    const { protocol } = new URL(value);
    if (protocol === "http:" || protocol === "https:") {
      return value;
    }
  } catch {
    // fall through to the single failure below
  }
  return fail("url is not an http(s) URL");
}

function readCapability(value: unknown): DevServerCapability {
  const fields = asRecord(value, "capability");
  if (bool(fields, "available")) {
    return { available: true };
  }
  const reason = str(fields, "reason");
  if (reason === "unsupported-host") {
    return UNSUPPORTED_HOST;
  }
  if (reason === "unsupported-platform") {
    return { available: false, reason, platform: str(fields, "platform") };
  }
  return fail("capability.reason is not a known value");
}

function readBinding(value: unknown): DevServerBinding {
  const fields = asRecord(value, "binding");
  return { family: oneOf(fields, "family", FAMILIES), address: str(fields, "address") };
}

function readRow(value: unknown): DevServerRow {
  const fields = asRecord(value, "row");
  const port = count(fields, "port");
  if (port < 1 || port > MAX_PORT) {
    return fail("port is out of range");
  }
  const url = nullable(fields, "url", str);
  return {
    id: str(fields, "id"),
    instanceToken: str(fields, "instanceToken"),
    workspacePath: str(fields, "workspacePath"),
    displayRoot: str(fields, "displayRoot"),
    port,
    bindings: list(fields, "bindings", readBinding),
    sharedEndpoint: bool(fields, "sharedEndpoint"),
    observedAt: timestamp(fields, "observedAt"),
    liveness: oneOf(fields, "liveness", LIVENESS),
    stoppedAt: nullable(fields, "stoppedAt", timestamp),
    protocol: oneOf(fields, "protocol", PROTOCOLS),
    url: url === null ? null : webUrl(url),
    identificationError: nullable(fields, "identificationError", str),
  };
}

function readDiagnostic(value: unknown): DevServerDiagnostic {
  const fields = asRecord(value, "diagnostic");
  return { code: str(fields, "code"), message: str(fields, "message") };
}

function readRootDiagnostic(value: unknown): DevServerRootDiagnostic {
  const fields = asRecord(value, "root diagnostic");
  return {
    code: oneOf(fields, "code", ROOT_DIAGNOSTIC_CODES),
    root: str(fields, "root"),
    message: str(fields, "message"),
  };
}

/** Exported for tests; production callers get validation through the four host calls. */
export function parseSnapshot(value: unknown): DevServerSnapshot {
  const fields = asRecord(value, "snapshot");
  return {
    generation: count(fields, "generation"),
    sequence: count(fields, "sequence"),
    observedAt: nullable(fields, "observedAt", timestamp),
    capability: readCapability(fields.capability),
    completeness: oneOf<ScanCompleteness | "pending">(
      fields,
      "completeness",
      COMPLETENESS_OR_PENDING,
    ),
    metadata: oneOf<ScanCompleteness | "pending">(fields, "metadata", COMPLETENESS_OR_PENDING),
    rows: list(fields, "rows", readRow),
    diagnostics: list(fields, "diagnostics", readDiagnostic),
    rootDiagnostics: list(fields, "rootDiagnostics", readRootDiagnostic),
  };
}

export function parseRootsReply(value: unknown): DevServerRootsReply {
  const fields = asRecord(value, "roots reply");
  return {
    capability: readCapability(fields.capability),
    applied: bool(fields, "applied"),
    generation: count(fields, "generation"),
    rootDiagnostics: list(fields, "rootDiagnostics", readRootDiagnostic),
  };
}

export function parseResolveResult(value: unknown): DevServerResolveResult {
  const fields = asRecord(value, "resolve result");
  switch (str(fields, "status")) {
    case "ready":
      return {
        status: "ready",
        id: str(fields, "id"),
        url: webUrl(str(fields, "url")),
        protocol: oneOf(fields, "protocol", WEB_PROTOCOLS),
      };
    case "stale":
      return { status: "stale" };
    case "unavailable":
      return { status: "unavailable", reason: oneOf(fields, "reason", UNAVAILABLE_REASONS) };
    case "unknown-protocol":
      return { status: "unknown-protocol", error: nullable(fields, "error", str) };
    default:
      return fail("status is not a known value");
  }
}

function assertRoots(roots: readonly string[]): void {
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== "string")) {
    throw new TypeError("Dev server roots must be an array of strings");
  }
}

/** An empty snapshot for a host that cannot discover anything. */
function unsupportedSnapshot(): DevServerSnapshot {
  return {
    generation: 0,
    sequence: 0,
    observedAt: null,
    capability: UNSUPPORTED_HOST,
    completeness: "pending",
    metadata: "pending",
    rows: [],
    diagnostics: [],
    rootDiagnostics: [],
  };
}

/** Replace this window's observed roots. Unsupported hosts answer locally, no IPC. */
export async function setDevServerRoots(roots: readonly string[]): Promise<DevServerRootsReply> {
  assertRoots(roots);
  if (!devServerHostPresent()) {
    return { capability: UNSUPPORTED_HOST, applied: true, generation: 0, rootDiagnostics: [] };
  }
  return parseRootsReply(await invoke<unknown>("dev_servers_set_roots", { roots }));
}

/** The cached snapshot for this window; does not start a scan or a subscription. */
export async function getDevServerSnapshot(): Promise<DevServerSnapshot> {
  if (!devServerHostPresent()) {
    return unsupportedSnapshot();
  }
  return parseSnapshot(await invoke<unknown>("dev_servers_snapshot", {}));
}

/** Idempotently drop this window's interest. */
export async function releaseDevServers(): Promise<void> {
  if (!devServerHostPresent()) {
    return;
  }
  await invoke<unknown>("dev_servers_release", {});
}

/** Revalidate one instance right before acting on its URL. */
export async function resolveDevServer(
  id: string,
  instanceToken: string,
): Promise<DevServerResolveResult> {
  if (!devServerHostPresent()) {
    return { status: "unavailable", reason: "unsupported-platform" };
  }
  return parseResolveResult(await invoke<unknown>("dev_servers_resolve", { id, instanceToken }));
}

export const devServerHost: DevServerHost = {
  setRoots: setDevServerRoots,
  snapshot: getDevServerSnapshot,
  release: releaseDevServers,
  resolve: resolveDevServer,
};
