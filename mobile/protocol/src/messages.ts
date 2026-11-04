/**
 * App messages (design §6): what travels inside sealed frames. Requests go phone → desktop and the
 * desktop is the trust boundary for them; responses and events go back and the phone is the trust
 * boundary for those, so every string meant for display is sanitised on parse. Every parser
 * returns null on anything malformed or unknown instead of throwing.
 */
import { displayText } from "./display-text";
import { MAX_INPUT_CHARS, MAX_READ_LINES, MAX_SEND_CHARS } from "./limits";
import { parseTree, type Tree } from "./tree";
import {
  isIntegerIn,
  isRecord,
  isSafeNonNegative,
  isStringIn,
  oneOf,
  parseList,
  type JsonObject,
} from "./validate";

export { displayText } from "./display-text";

export const METHODS = [
  "tree.subscribe",
  "tree.unsubscribe",
  "pane.subscribe",
  "pane.unsubscribe",
  "pane.input",
  "pane.send",
  "pane.read",
  "pane.open",
  "projects.list",
  "agents.list",
  "files.list",
  "files.read",
  "changes.list",
  "changes.diff",
  "usage.get",
] as const;
export type Method = (typeof METHODS)[number];

export const ERROR_CODES = [
  "invalid",
  "unknown-method",
  "no-target",
  "not-an-agent-pane",
  "busy",
  "expired",
  "too-large",
  "outside-root",
  "not-found",
  "unavailable",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const OS_NAMES = ["macos", "windows", "linux"] as const;

/** Longest path or id string a request may carry; the desktop validates the meaning. */
export const MAX_PATH_CHARS = 4096;
export const MAX_SUB_CHARS = 64;
export const MAX_LAN_ADDRESSES = 8;

type Empty = Record<string, never>;

export interface MethodParams {
  "tree.subscribe": Empty;
  "tree.unsubscribe": Empty;
  "pane.subscribe": { paneId: number };
  "pane.unsubscribe": { sub: string };
  "pane.input": { paneId: number; data: string };
  "pane.send": { paneId: number; text: string; submit: boolean };
  "pane.read": { paneId: number; lines: number };
  "pane.open": {
    projectPath: string;
    checkoutPath: string;
    agent: string;
    prompt: string | null;
  };
  "projects.list": Empty;
  "agents.list": Empty;
  "files.list": { root: string; path: string };
  "files.read": { root: string; path: string };
  "changes.list": { root: string };
  "changes.diff": { root: string; path: string };
  "usage.get": Empty;
}

export type Request = {
  [M in Method]: { readonly id: number; readonly m: M; readonly p: MethodParams[M] };
}[Method];

export type Response =
  | { readonly id: number; readonly ok: true; readonly r: JsonObject }
  | {
      readonly id: number;
      readonly ok: false;
      readonly e: { readonly code: ErrorCode; readonly message: string };
    };

export interface LanAddress {
  readonly host: string;
  readonly port: number;
}

export type AppEvent =
  | {
      readonly ev: "session.start";
      readonly p: { readonly device: string; readonly appVersion: string };
    }
  | {
      readonly ev: "desktop";
      readonly p: {
        readonly name: string;
        readonly os: (typeof OS_NAMES)[number];
        readonly appVersion: string;
        readonly protocol: number;
        readonly lan: readonly LanAddress[];
      };
    }
  | { readonly ev: "tree"; readonly p: { readonly tree: Tree } }
  | {
      readonly ev: "term.snapshot";
      readonly p: {
        readonly sub: string;
        readonly paneId: number;
        readonly cols: number;
        readonly rows: number;
        readonly data: string;
        readonly seq: number;
        readonly last: boolean;
      };
    }
  | { readonly ev: "term.data"; readonly p: { readonly sub: string; readonly data: string } }
  | {
      readonly ev: "term.resize";
      readonly p: { readonly sub: string; readonly cols: number; readonly rows: number };
    }
  | {
      readonly ev: "term.end";
      readonly p: { readonly sub: string; readonly reason: "closed" | "unsubscribed" | "moved" };
    }
  | {
      readonly ev: "chunk";
      readonly p: {
        readonly id: string;
        readonly seq: number;
        readonly last: boolean;
        readonly data: string;
      };
    };

export type AppMessage =
  | { readonly kind: "request"; readonly request: Request }
  | { readonly kind: "response"; readonly response: Response }
  | { readonly kind: "event"; readonly event: AppEvent };

// --- requests ------------------------------------------------------------------------------

function paneId(value: unknown): value is number {
  return isSafeNonNegative(value);
}
function pathString(value: unknown, allowEmpty = false): value is string {
  return isStringIn(value, allowEmpty ? 0 : 1, MAX_PATH_CHARS) && !value.includes("\u0000");
}

type ParamParsers = { [M in Method]: (p: JsonObject) => MethodParams[M] | null };

const PARAM_PARSERS: ParamParsers = {
  "tree.subscribe": () => ({}),
  "tree.unsubscribe": () => ({}),
  "pane.subscribe": (p) => (paneId(p.paneId) ? { paneId: p.paneId } : null),
  "pane.unsubscribe": (p) => (isStringIn(p.sub, 1, MAX_SUB_CHARS) ? { sub: p.sub } : null),
  "pane.input": (p) =>
    paneId(p.paneId) && isStringIn(p.data, 1, MAX_INPUT_CHARS)
      ? { paneId: p.paneId, data: p.data }
      : null,
  "pane.send": (p) =>
    paneId(p.paneId) && isStringIn(p.text, 0, MAX_SEND_CHARS) && typeof p.submit === "boolean"
      ? { paneId: p.paneId, text: p.text, submit: p.submit }
      : null,
  "pane.read": (p) =>
    paneId(p.paneId) && isIntegerIn(p.lines, 1, MAX_READ_LINES)
      ? { paneId: p.paneId, lines: p.lines }
      : null,
  "pane.open": (p) =>
    pathString(p.projectPath) &&
    pathString(p.checkoutPath) &&
    typeof p.agent === "string" &&
    /^[A-Za-z0-9._-]{1,64}$/.test(p.agent) &&
    (p.prompt === null || isStringIn(p.prompt, 0, MAX_SEND_CHARS))
      ? {
          projectPath: p.projectPath,
          checkoutPath: p.checkoutPath,
          agent: p.agent,
          prompt: p.prompt,
        }
      : null,
  "projects.list": () => ({}),
  "agents.list": () => ({}),
  "files.list": (p) =>
    pathString(p.root) && pathString(p.path, true) ? { root: p.root, path: p.path } : null,
  "files.read": (p) =>
    pathString(p.root) && pathString(p.path, true) ? { root: p.root, path: p.path } : null,
  "changes.list": (p) => (pathString(p.root) ? { root: p.root } : null),
  "changes.diff": (p) =>
    pathString(p.root) && pathString(p.path, true) ? { root: p.root, path: p.path } : null,
  "usage.get": () => ({}),
};

export function parseRequest(value: unknown): Request | null {
  if (!isRecord(value) || !isSafeNonNegative(value.id)) return null;
  const m = oneOf(METHODS, value.m);
  if (m === null || !isRecord(value.p)) return null;
  const params = (PARAM_PARSERS[m] as (p: JsonObject) => unknown)(value.p);
  return params === null ? null : ({ id: value.id, m, p: params } as Request);
}

// --- responses -----------------------------------------------------------------------------

export function parseResponse(value: unknown): Response | null {
  if (!isRecord(value) || !isSafeNonNegative(value.id) || typeof value.ok !== "boolean") {
    return null;
  }
  if (value.ok) return isRecord(value.r) ? { id: value.id, ok: true, r: value.r } : null;
  if (!isRecord(value.e)) return null;
  const code = oneOf(ERROR_CODES, value.e.code);
  if (code === null || typeof value.e.message !== "string") return null;
  return { id: value.id, ok: false, e: { code, message: displayText(value.e.message, 300) } };
}

export function okResponse(id: number, r: JsonObject = {}): Response {
  return { id, ok: true, r };
}

export function errorResponse(id: number, code: ErrorCode, message: string): Response {
  return { id, ok: false, e: { code, message: displayText(message, 300) } };
}

// --- events --------------------------------------------------------------------------------

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseLan(value: unknown): LanAddress | null {
  if (!isRecord(value) || typeof value.host !== "string" || !isIntegerIn(value.port, 1, 65535)) {
    return null;
  }
  const match = IPV4.exec(value.host);
  if (match === null || match.slice(1).some((octet) => Number(octet) > 255)) return null;
  return { host: value.host, port: value.port };
}

function dims(p: JsonObject): boolean {
  return isIntegerIn(p.cols, 1, 1000) && isIntegerIn(p.rows, 1, 1000);
}

export function parseEvent(value: unknown): AppEvent | null {
  if (!isRecord(value) || typeof value.ev !== "string" || !isRecord(value.p)) return null;
  const p = value.p;
  switch (value.ev) {
    case "session.start":
      return typeof p.device === "string" && typeof p.appVersion === "string"
        ? {
            ev: "session.start",
            p: { device: displayText(p.device, 64), appVersion: displayText(p.appVersion, 32) },
          }
        : null;
    case "desktop": {
      const os = oneOf(OS_NAMES, p.os);
      const lan = parseList(p.lan, MAX_LAN_ADDRESSES, parseLan);
      return typeof p.name === "string" &&
        typeof p.appVersion === "string" &&
        os !== null &&
        isSafeNonNegative(p.protocol) &&
        lan !== null
        ? {
            ev: "desktop",
            p: {
              name: displayText(p.name, 64) || "Deck",
              os,
              appVersion: displayText(p.appVersion, 32),
              protocol: p.protocol,
              lan,
            },
          }
        : null;
    }
    case "tree": {
      const tree = parseTree(p.tree);
      return tree === null ? null : { ev: "tree", p: { tree } };
    }
    case "term.snapshot":
      return isStringIn(p.sub, 1, MAX_SUB_CHARS) &&
        paneId(p.paneId) &&
        dims(p) &&
        typeof p.data === "string" &&
        isSafeNonNegative(p.seq) &&
        typeof p.last === "boolean"
        ? {
            ev: "term.snapshot",
            p: {
              sub: p.sub,
              paneId: p.paneId,
              cols: p.cols as number,
              rows: p.rows as number,
              data: p.data,
              seq: p.seq,
              last: p.last,
            },
          }
        : null;
    case "term.data":
      return isStringIn(p.sub, 1, MAX_SUB_CHARS) && typeof p.data === "string"
        ? { ev: "term.data", p: { sub: p.sub, data: p.data } }
        : null;
    case "term.resize":
      return isStringIn(p.sub, 1, MAX_SUB_CHARS) && dims(p)
        ? {
            ev: "term.resize",
            p: { sub: p.sub, cols: p.cols as number, rows: p.rows as number },
          }
        : null;
    case "term.end": {
      const reason = oneOf(["closed", "unsubscribed", "moved"] as const, p.reason);
      return isStringIn(p.sub, 1, MAX_SUB_CHARS) && reason !== null
        ? { ev: "term.end", p: { sub: p.sub, reason } }
        : null;
    }
    case "chunk":
      return isStringIn(p.id, 1, MAX_SUB_CHARS) &&
        isSafeNonNegative(p.seq) &&
        typeof p.last === "boolean" &&
        typeof p.data === "string"
        ? { ev: "chunk", p: { id: p.id, seq: p.seq, last: p.last, data: p.data } }
        : null;
    default:
      return null;
  }
}

/** Requests carry `m`, events `ev`, responses `ok`; anything else is not ours. */
export function parseAppMessage(value: unknown): AppMessage | null {
  if (!isRecord(value)) return null;
  if ("m" in value) {
    const request = parseRequest(value);
    return request === null ? null : { kind: "request", request };
  }
  if ("ev" in value) {
    const event = parseEvent(value);
    return event === null ? null : { kind: "event", event };
  }
  if ("ok" in value) {
    const response = parseResponse(value);
    return response === null ? null : { kind: "response", response };
  }
  return null;
}
