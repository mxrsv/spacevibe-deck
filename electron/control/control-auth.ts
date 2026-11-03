/**
 * Who may call the control routes (spec 2026-11-03-agent-orchestration, ORC4-5).
 *
 * The `deck` command posts to `/control/v1/<group>/<verb>` on the hook listener, so it passes
 * the same gate hooks do (pane id, per-pane token, constant-time compare) and one more: the tty
 * of the agent process that ran the shim must be the pane's own, for EVERY caller. A hook needs
 * that check only for Codex, whose daemon inherits a pane's environment; here any process that
 * inherited the three `DECK_*` variables could otherwise drive the pane, so the tty is what
 * says "this came from inside that pane's terminal".
 *
 * Pure, so it is tested before a listener exists. Checks run cheapest and least revealing
 * first: the path shape, the method, then identity. An unauthenticated probe therefore sees a
 * 403 and never learns which commands exist or what a body must hold.
 */
import {
  HEADER_PANE,
  HEADER_TOKEN,
  HEADER_TTY,
  HOOK_MAX_BODY_BYTES,
  PANE_ID_PATTERN,
  headerValue,
  tokensMatch,
  type HookRequestHead,
} from "../agent-hooks/hook-request";

/** Every control URL starts here; the hook listener hands such a request to the control router. */
export const CONTROL_PATH_PREFIX = "/control/";
/** Control bodies are capped like hook posts. */
export const CONTROL_MAX_BODY_BYTES = HOOK_MAX_BODY_BYTES;
/** The longest one HTTP call may hold the shim: a worktree add, or one slice of a `wait`. */
export const CONTROL_CALL_CAP_MS = 60_000;

/** `status`, or `<group>/<verb>` in lower-case letters and hyphens. */
const COMMAND_PATH = /^\/control\/v1\/(status|[a-z][a-z-]{0,31}\/[a-z][a-z-]{0,31})$/;

export type ControlRefusal = {
  readonly ok: false;
  readonly status: 403 | 404 | 405 | 413;
  /** The closed answer code; one code for "no pane", "wrong token" and "wrong tty". */
  readonly error: "forbidden" | "unknown-command" | "method-not-allowed" | "too-large";
  /** For the log only, never sent to the caller. */
  readonly reason: string;
  /** The pane the request claimed, when its header was well-formed. */
  readonly paneId: number | null;
};

export type ControlHeadResult =
  ControlRefusal | { readonly ok: true; readonly paneId: number; readonly command: string };

function refusal(
  status: ControlRefusal["status"],
  error: ControlRefusal["error"],
  reason: string,
  paneId: number | null,
): ControlRefusal {
  return { ok: false, status, error, reason, paneId };
}

/** The route a URL names (`status`, `worktree/create`), or null when it is not a control path. */
export function controlCommandOfUrl(url: string | undefined): string | null {
  return COMMAND_PATH.exec((url ?? "").split("?")[0])?.[1] ?? null;
}

/** The head of a control request: path shape, method, pane, token, tty and declared length. */
export function authorizeControlHead(
  head: HookRequestHead,
  tokenFor: (paneId: number) => string | null,
  ttyFor: (paneId: number) => string | null,
): ControlHeadResult {
  const command = controlCommandOfUrl(head.url);
  if (command === null) {
    return refusal(404, "unknown-command", "path shape", null);
  }
  if (head.method !== "POST") {
    return refusal(405, "method-not-allowed", "method", null);
  }
  const paneHeader = headerValue(head.headers, HEADER_PANE) ?? "";
  const paneId = PANE_ID_PATTERN.test(paneHeader) ? Number(paneHeader) : null;
  if (paneId === null) {
    // A broken pane header means a broken environment, not a usage error: 403, not the hooks' 400.
    return refusal(403, "forbidden", "pane header", null);
  }
  const expected = tokenFor(paneId);
  const offered = headerValue(head.headers, HEADER_TOKEN) ?? "";
  if (expected === null || !tokensMatch(expected, offered)) {
    return refusal(403, "forbidden", expected === null ? "no such pane" : "wrong token", paneId);
  }
  const tty = ttyFor(paneId) ?? "";
  const reported = headerValue(head.headers, HEADER_TTY)?.trim() ?? "";
  if (tty === "" || reported !== tty) {
    return refusal(403, "forbidden", "wrong tty", paneId);
  }
  const length = headerValue(head.headers, "content-length");
  if (length !== undefined && Number(length) > CONTROL_MAX_BODY_BYTES) {
    return refusal(413, "too-large", "body too large", paneId);
  }
  return { ok: true, paneId, command };
}
