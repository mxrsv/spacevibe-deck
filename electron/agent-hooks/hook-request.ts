/**
 * The hook endpoint's REQUEST VALIDATOR — pure, so it is tested before the
 * listener exists (agent-signal contract layer, stage 2; spec §4).
 *
 * Every post a CLI hook makes to Deck's loopback endpoint passes through
 * `validateHookRequest` and nothing else decides whether it reaches the
 * tracker. The rules, each with the failure it closes:
 *
 * - **POST to `/hook`, `/hook/codex` or `/hook/opencode`, and only those.** Anything else is
 *   a 404: the endpoint has one job and answers no other question about the process.
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
export const CODEX_HOOK_PATH = "/hook/codex";
export const OPENCODE_HOOK_PATH = "/hook/opencode";
export const HOOK_MAX_BODY_BYTES = 64 * 1024;
/** Only `Stop` forwards stdin; every other Codex event posts a bounded body of its own. */
export const CODEX_HOOK_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const HEADER_PANE = "x-deck-pane";
export const HEADER_TOKEN = "x-deck-token";
/** The tty of the `codex` process that ran the hook; see `validateHookHead`. */
export const HEADER_TTY = "x-deck-tty";
/** A pane id as the `X-Deck-Pane` header and `DECK_PANE_ID` write it: no sign, no leading zero. */
export const PANE_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/** The Codex events Deck registers, and the two that are session-scoped and carry no `turn_id`. */
const CODEX_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "Interrupt",
];
const CODEX_SESSION_EVENTS = ["SessionStart", "SessionEnd"];
/**
 * The seven events Deck's opencode plugin posts (OC1). `Start`/`Stop` are the busy and idle
 * edges of the pane's root session; `PermissionReplied` ends an ask.
 */
const OPENCODE_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "Start",
  "Stop",
  "Failed",
  "PermissionRequest",
  "PermissionReplied",
];

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
  readonly agent?: "codex" | "opencode";
  readonly turnId?: string;
  readonly paneId: number;
  readonly event: string;
  readonly sessionId: string;
  readonly cwd: string | null;
  /** `last_assistant_message` on `Stop`, first line, capped. */
  readonly message: string | null;
  /**
   * `notification_type` / matcher on `Notification`, `tool_name` on `PermissionRequest`; the
   * capped error message on opencode's `Failed`.
   */
  readonly detail: string | null;
}

export type HookAgent = "claude" | "codex" | "opencode";

/** The agent a request path belongs to; null for a path the endpoint does not serve. */
export function hookAgentOfUrl(url: string | undefined): HookAgent | null {
  switch ((url ?? "").split("?")[0]) {
    case HOOK_PATH:
      return "claude";
    case CODEX_HOOK_PATH:
      return "codex";
    case OPENCODE_HOOK_PATH:
      return "opencode";
    default:
      return null;
  }
}

/** Only a Codex `Stop` forwards stdin; every other agent's post is small. */
export function hookMaxBodyBytes(agent: HookAgent): number {
  return agent === "codex" ? CODEX_HOOK_MAX_BODY_BYTES : HOOK_MAX_BODY_BYTES;
}

export type HookRefusal =
  | { readonly ok: false; readonly status: 404 | 405 | 400 | 403 | 413; readonly reason: string }
  | { readonly ok: true; readonly paneId: number };

export function headerValue(headers: HookRequestHead["headers"], name: string): string | undefined {
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
  ttyFor: (paneId: number) => string | null,
): HookRefusal {
  const agent = hookAgentOfUrl(head.url);
  if (agent === null) {
    return { ok: false, status: 404, reason: "unknown path" };
  }
  if (head.method !== "POST") {
    return { ok: false, status: 405, reason: "method" };
  }
  const paneHeader = headerValue(head.headers, HEADER_PANE) ?? "";
  const paneId = PANE_ID_PATTERN.test(paneHeader) ? Number(paneHeader) : null;
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
  // Codex 0.162 hosts an interactive session in a shared app-server daemon, and a hook runs with
  // the HOSTING process's environment, so a daemon started from a pane carries that pane's
  // token. The script reports the tty of the `codex` process it runs under; a daemon has none
  // (`??`), and another pane's codex has another tty.
  if (agent === "codex") {
    const tty = ttyFor(paneId) ?? "";
    const offered = headerValue(head.headers, HEADER_TTY)?.trim() ?? "";
    if (tty === "" || offered !== tty) {
      return { ok: false, status: 403, reason: "tty" };
    }
  }
  const length = headerValue(head.headers, "content-length");
  if (length !== undefined && Number(length) > hookMaxBodyBytes(agent)) {
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
export function parseHookBody(
  paneId: number,
  body: string,
  agent: HookAgent = "claude",
): HookPost | null {
  if (Buffer.byteLength(body, "utf8") > hookMaxBodyBytes(agent)) {
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
  if (agent === "codex") {
    if (!CODEX_EVENTS.includes(event)) return null;
    // SUB1: a top-level `agent_id` means the hook fired inside a subagent. It is dropped here,
    // before the generation check, so it can neither change the pane's state nor its session.
    if (typeof node.agent_id === "string" && node.agent_id !== "") return null;
    if (
      !CODEX_SESSION_EVENTS.includes(event) &&
      (typeof node.turn_id !== "string" || !SESSION_ID_SAFE.test(node.turn_id))
    )
      return null;
  }
  if (agent === "opencode") {
    // The plugin sends the event, the session and, for `Failed`, a message: nothing else is read.
    if (!OPENCODE_EVENTS.includes(event)) return null;
    return {
      agent,
      paneId,
      event,
      sessionId,
      cwd: null,
      message: null,
      detail: event === "Failed" ? optionalText(node.message) : null,
    };
  }
  const detail =
    optionalText(node.notification_type) ??
    optionalText(node.matcher) ??
    optionalText(node.tool_name) ??
    null;
  return {
    ...(agent === "codex"
      ? { agent, ...(typeof node.turn_id === "string" ? { turnId: node.turn_id } : {}) }
      : {}),
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
