/**
 * The flat payloads of the in-pane `deck` command's main → renderer channel (spec
 * 2026-11-03-agent-orchestration, ORC11-13, ORC16): the `control:command` event main pushes to
 * the window that owns a pane, and the `control_reply` command the renderer answers with.
 *
 * Both sides import the closed sets from here, so a command the renderer understands is exactly
 * a command main sends. Every key is always present, with `null` where a command does not use
 * it (R6: flat payloads), so a reader of either side sees the whole shape at once. Main checks a
 * reply field by field with `parseControlReply`, because the renderer is not the trust boundary
 * and some reply values end up printed in a terminal.
 */

export const CONTROL_COMMAND_NAMES = ["open", "send", "read", "close"] as const;
export type ControlCommandName = (typeof CONTROL_COMMAND_NAMES)[number];

/** `pane read` without `--lines` returns this many rows (ORC13). */
export const CONTROL_READ_DEFAULT_LINES = 200;
/** The most rows one `pane read` returns (ORC13). */
export const CONTROL_READ_MAX_LINES = 2000;
/** Enter goes out this long after the paste, and only if the same agent process is still idle (ORC12). */
export const CONTROL_SUBMIT_DELAY_MS = 500;

/** What the renderer says happened to a paste; the same words `injectIntoPane` answers with. */
export const CONTROL_SEND_OUTCOMES = [
  "sent",
  "pasted",
  "failed",
  "busy",
  "no-target",
  "stale",
] as const;
export type ControlSendOutcome = (typeof CONTROL_SEND_OUTCOMES)[number];

/** The refusals a renderer may give; anything else main reports as `renderer-error`. */
export const CONTROL_REPLY_ERRORS = [
  "unknown-agent",
  "spawn-failed",
  "no-target",
  "not-closed",
  "empty-text",
  "not-an-agent-pane",
  "invalid",
  "renderer-error",
] as const;
export type ControlReplyError = (typeof CONTROL_REPLY_ERRORS)[number];

export interface ControlCommandPayload {
  readonly requestId: string;
  readonly command: ControlCommandName;
  /**
   * The pane the command is about. For `open` it is the CALLER's pane: the new tab opens in the
   * window that owns it.
   */
  readonly paneId: number;
  readonly cwd: string | null;
  readonly agent: string | null;
  readonly name: string | null;
  readonly text: string | null;
  readonly submit: boolean | null;
  readonly expectedAgent: string | null;
  readonly lines: number | null;
  readonly force: boolean | null;
}

export interface ControlReplyPayload {
  readonly requestId: string;
  readonly ok: boolean;
  readonly paneId: number | null;
  readonly text: string | null;
  /** What happened to a paste: one of `CONTROL_SEND_OUTCOMES`. */
  readonly outcome: string | null;
  /** Why a command was refused: one of `CONTROL_REPLY_ERRORS`. */
  readonly error: string | null;
}

/** A request id is a UUID; anything much longer or with a control character is not ours. */
const MAX_REQUEST_ID_LENGTH = 64;
/** A reply's `outcome` or `error` is a short code. */
const MAX_CODE_LENGTH = 64;
/** A reply's text is a screen of scrollback; this bounds what main keeps from a misbehaving window. */
export const MAX_REPLY_TEXT_LENGTH = 4_000_000;
const CONTROL_CHARACTER = /\p{Cc}/u;

function requestIdOf(value: unknown): string | null {
  return typeof value === "string" &&
    value !== "" &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    !CONTROL_CHARACTER.test(value)
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** `undefined` for a value that is neither a string within `limit` nor null. */
function stringOrNull(value: unknown, limit: number): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.length <= limit ? value : undefined;
}

function code(value: unknown): string | null | undefined {
  const text = stringOrNull(value, MAX_CODE_LENGTH);
  return text !== undefined && text !== null && CONTROL_CHARACTER.test(text) ? undefined : text;
}

function booleanOrNull(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  return typeof value === "boolean" ? value : undefined;
}

/** The checked command a window received, or null when any key is outside its shape. */
export function parseControlCommand(value: unknown): ControlCommandPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const node = value as Readonly<Record<string, unknown>>;
  const requestId = requestIdOf(node.requestId);
  const command = CONTROL_COMMAND_NAMES.find((name) => name === node.command);
  const paneId = positiveInteger(node.paneId);
  const cwd = stringOrNull(node.cwd, Number.MAX_SAFE_INTEGER);
  const agent = stringOrNull(node.agent, MAX_CODE_LENGTH);
  const name = stringOrNull(node.name, Number.MAX_SAFE_INTEGER);
  const text = stringOrNull(node.text, Number.MAX_SAFE_INTEGER);
  const submit = booleanOrNull(node.submit);
  const expectedAgent = stringOrNull(node.expectedAgent, MAX_CODE_LENGTH);
  const lines = node.lines === null ? null : positiveInteger(node.lines);
  const force = booleanOrNull(node.force);
  if (
    requestId === null ||
    command === undefined ||
    paneId === null ||
    cwd === undefined ||
    agent === undefined ||
    name === undefined ||
    text === undefined ||
    submit === undefined ||
    expectedAgent === undefined ||
    force === undefined ||
    (node.lines !== null && lines === null)
  ) {
    return null;
  }
  return {
    requestId,
    command,
    paneId,
    cwd,
    agent,
    name,
    text,
    submit,
    expectedAgent,
    lines,
    force,
  };
}

/** The checked reply a window sent, or null when any key is outside its shape. */
export function parseControlReply(
  fields: Readonly<Record<keyof ControlReplyPayload, unknown>>,
): ControlReplyPayload | null {
  const requestId = requestIdOf(fields.requestId);
  const paneId = fields.paneId === null ? null : positiveInteger(fields.paneId);
  const text = stringOrNull(fields.text, MAX_REPLY_TEXT_LENGTH);
  const outcome = code(fields.outcome);
  const error = code(fields.error);
  if (
    requestId === null ||
    typeof fields.ok !== "boolean" ||
    (fields.paneId !== null && paneId === null) ||
    text === undefined ||
    outcome === undefined ||
    error === undefined
  ) {
    return null;
  }
  return { requestId, ok: fields.ok, paneId, text, outcome, error };
}
