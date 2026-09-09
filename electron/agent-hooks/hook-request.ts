/**
 * The hook endpoint's REQUEST VALIDATOR — pure, so it is tested before the
 * listener exists (agent-signal contract layer, stage 2; spec §4).
 *
 * Every post a CLI hook makes to Deck's loopback endpoint passes through
 * `validateHookRequest` and nothing else decides whether it reaches the
 * tracker. The rules, each with the failure it closes:
 *
 * - **POST to `/hook`, and only that.** Anything else is a 404: the endpoint
 *   has one job and answers no other question about the process.
 * - **`X-Deck-Pane` names a LIVE pane** and **`X-Deck-Token` matches that
 *   pane's token** under a constant-time compare. The pane env carries both
 *   (`DECK_PANE_ID`, `DECK_HOOK_TOKEN`); a post that knows neither is not
 *   from a shell Deck spawned. A wrong token is a 403 that says nothing about
 *   which half was wrong.
 * - **Body ≤ 64 KiB** — checked on `Content-Length` BEFORE buffering and on
 *   the streamed bytes as they arrive, so an oversize post is cut off, never
 *   held in memory (Orca #15791 is the peer-app precedent the spec cites).
 * - **Body is a JSON object with a string `hook_event_name` and a safe
 *   `session_id`.** The same `SESSION_ID_SAFE` shape every other session id
 *   in Deck passes before it is used; a hook whose payload names no session
 *   cannot be generation-checked and is refused.
 *
 * A refused request is answered with its status and NEVER reaches
 * `emitToOwner`; the hook script exits 0 regardless, so the CLI never sees
 * Deck's answer as its own failure.
 */
import { timingSafeEqual } from "node:crypto";

export const HOOK_PATH = "/hook";
export const HOOK_MAX_BODY_BYTES = 64 * 1024;
export const HEADER_PANE = "x-deck-pane";
export const HEADER_TOKEN = "x-deck-token";

const SESSION_ID_SAFE = /^[A-Za-z0-9._-]{1,128}$/;
/** Event names are CLI identifiers: letters only, bounded. */
const EVENT_NAME_SAFE = /^[A-Za-z]{1,64}$/;
const TEXT_MAX = 2000;

export interface HookRequestHead {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** What survives validation: the fields the renderer's map reads, and nothing else. */
export interface HookPost {
  readonly paneId: number;
  readonly event: string;
  readonly sessionId: string;
  readonly cwd: string | null;
  /** `last_assistant_message` on `Stop`, first line, capped. */
  readonly message: string | null;
  /** `notification_type` / matcher on `Notification`, `tool_name` on `PermissionRequest`. */
  readonly detail: string | null;
}

export type HookRefusal =
  | { readonly ok: false; readonly status: 404 | 405 | 400 | 403 | 413; readonly reason: string }
  | { readonly ok: true; readonly paneId: number };

function headerValue(headers: HookRequestHead["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The head of a request: method, path, pane and token. Answered before any
 * body byte is read, so a stranger's post costs one header parse.
 */
export function validateHookHead(
  head: HookRequestHead,
  tokenFor: (paneId: number) => string | null,
): HookRefusal {
  const url = head.url ?? "";
  const pathOnly = url.split("?")[0];
  if (pathOnly !== HOOK_PATH) {
    return { ok: false, status: 404, reason: "unknown path" };
  }
  if (head.method !== "POST") {
    return { ok: false, status: 405, reason: "method" };
  }
  const paneHeader = headerValue(head.headers, HEADER_PANE) ?? "";
  const paneId = /^[1-9][0-9]{0,9}$/.test(paneHeader) ? Number(paneHeader) : null;
  if (paneId === null) {
    return { ok: false, status: 400, reason: "pane header" };
  }
  const expected = tokenFor(paneId);
  const offered = headerValue(head.headers, HEADER_TOKEN) ?? "";
  if (expected === null || !tokensMatch(expected, offered)) {
    // One answer for "no such pane" and "wrong token": the difference is
    // exactly what a probe would want to learn.
    return { ok: false, status: 403, reason: "pane or token" };
  }
  const length = headerValue(head.headers, "content-length");
  if (length !== undefined && Number(length) > HOOK_MAX_BODY_BYTES) {
    return { ok: false, status: 413, reason: "body too large" };
  }
  return { ok: true, paneId };
}

/** Constant-time equality over the token bytes; a length mismatch is a mismatch. */
export function tokensMatch(expected: string, offered: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(offered, "utf8");
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function firstLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (line === undefined) {
    return null;
  }
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1)}…` : line;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? firstLine(value) : null;
}

/**
 * The body, once buffered under the cap. Returns the flat post the renderer
 * receives, or null for anything that is not the shape a CLI hook writes.
 */
export function parseHookBody(paneId: number, body: string): HookPost | null {
  if (Buffer.byteLength(body, "utf8") > HOOK_MAX_BODY_BYTES) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const node = parsed as Record<string, unknown>;
  const event = node.hook_event_name;
  const sessionId = node.session_id;
  if (
    typeof event !== "string" ||
    !EVENT_NAME_SAFE.test(event) ||
    typeof sessionId !== "string" ||
    !SESSION_ID_SAFE.test(sessionId)
  ) {
    return null;
  }
  const detail =
    optionalText(node.notification_type) ??
    optionalText(node.matcher) ??
    optionalText(node.tool_name) ??
    null;
  return {
    paneId,
    event,
    sessionId,
    cwd: typeof node.cwd === "string" && node.cwd !== "" ? node.cwd : null,
    message: optionalText(node.last_assistant_message),
    detail,
  };
}

/**
 * The generation check (spec §4, stage 2; stage 3's "an older event never
 * overwrites a newer generation"), kept as a pure decision over one pane's
 * current session so it can be tested without a listener.
 *
 * `SessionStart` names the occupant; `SessionEnd` ends it; everything else
 * must come from the current occupant — or be the first the pane has ever
 * reported, for a CLI whose start hook was lost. A post from a previous
 * occupant is dropped, never forwarded.
 */
export function nextPaneSession(
  current: string | null,
  post: Pick<HookPost, "event" | "sessionId">,
): { readonly accept: boolean; readonly current: string | null } {
  if (post.event === "SessionStart") {
    return { accept: true, current: post.sessionId };
  }
  if (post.event === "SessionEnd") {
    return current === null || current === post.sessionId
      ? { accept: true, current: null }
      : { accept: false, current };
  }
  if (current === null) {
    return { accept: true, current: post.sessionId };
  }
  return { accept: current === post.sessionId, current };
}
