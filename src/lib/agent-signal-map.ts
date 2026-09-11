/**
 * The event map — one place where a CLI's own event becomes a rail state
 * (agent-signal contract layer, stages 2 and 3; spec §4 "`Stop` is not done
 * and `Notification` is not needs-input without its matcher — encoded once in
 * the adapter's event map"). Pure.
 *
 * Claude (hook posts, `source: "hook"`):
 * - `SessionStart`      → the occupant's session (no state)
 * - `Stop`              → completed, explicit, with the sentence
 * - `StopFailure`       → error — the CLI's own word, the only producer of `failed`
 * - `Notification`      → requested; the file installs it matched on
 *                         `permission_prompt|idle_prompt`, and the detail is
 *                         the matcher, so an unmatched kind reaching here is
 *                         still refused
 * - `PermissionRequest` → requested — fires when a tool call needs a decision
 * - `SessionEnd`        → nothing for state: the process table makes `ended`
 *                         within a poll, and a session end is not a failure
 * - anything else (`SubagentStop`, `TeammateIdle`, …) → nothing
 *
 * opencode (its server's events, `source: "server"`):
 * - `session.status` (busy/retry) → working; (idle) → completed
 * - `session.idle`                → completed
 * - `session.error`               → error
 * - `permission.asked` / `.v2.`   → requested
 * - `permission.replied` / `.v2.` → the ask was answered
 */

export type ContractKind =
  "session" | "working" | "completed" | "requested" | "answered" | "error" | "interrupted";

/** One flat `hook:event` payload, as the renderer facade validated it. */
export interface HookEvent {
  readonly turnId?: string;
  readonly paneId: number;
  readonly source: "hook" | "server";
  readonly agent: string;
  readonly event: string;
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly message: string | null;
  readonly detail: string | null;
  readonly receivedAt: number;
}

/** What the tracker takes: the kind, the session it is about, the detail and the sentence. */
export interface ContractSignal {
  readonly agent?: string;
  readonly turnId?: string;
  readonly source: "hook" | "server";
  readonly kind: ContractKind;
  readonly sessionId: string;
  readonly detail: string | null;
  readonly message: string | null;
  readonly observedAt: number;
}

const NOTIFICATION_KINDS = new Set(["permission_prompt", "idle_prompt"]);

function claudeKind(event: HookEvent): ContractKind | null {
  switch (event.event) {
    case "SessionStart":
      return "session";
    case "Stop":
      return "completed";
    case "StopFailure":
      return "error";
    case "PermissionRequest":
      return "requested";
    case "Notification":
      return event.detail !== null && NOTIFICATION_KINDS.has(event.detail) ? "requested" : null;
    default:
      return null;
  }
}

function codexKind(event: HookEvent): ContractKind | null {
  if (event.event === "SessionStart") return "session";
  if (!event.turnId) return null;
  switch (event.event) {
    case "UserPromptSubmit":
      return "working";
    case "Stop":
      return "completed";
    case "Interrupt":
      return "interrupted";
    case "PermissionRequest":
      return "requested";
    default:
      return null;
  }
}

function opencodeKind(event: HookEvent): ContractKind | null {
  switch (event.event) {
    case "session.status":
      // The client emits `session.status` only for busy/retry — idle comes as
      // `session.idle` — but the map states the rule rather than trusting it.
      return event.detail === "idle" ? "completed" : "working";
    case "session.idle":
      return "completed";
    case "session.error":
      return "error";
    case "permission.asked":
    case "permission.v2.asked":
      return "requested";
    case "permission.replied":
    case "permission.v2.replied":
      return "answered";
    default:
      return null;
  }
}

/** The signal an event carries, or null for an event that is not a state. */
export function contractSignalOf(event: HookEvent): ContractSignal | null {
  const kind =
    event.source === "hook" && event.agent === "claude"
      ? claudeKind(event)
      : event.source === "hook" && event.agent === "codex"
        ? codexKind(event)
        : event.source === "server" && event.agent === "opencode"
          ? opencodeKind(event)
          : null;
  if (kind === null) {
    return null;
  }
  const detail =
    kind === "requested"
      ? event.event === "PermissionRequest"
        ? event.detail === null
          ? "permission prompt"
          : `permission prompt — ${event.detail}`
        : event.event === "Notification"
          ? event.detail === "idle_prompt"
            ? "input needed"
            : "permission prompt"
          : event.detail === null
            ? "permission"
            : `permission — ${event.detail}`
      : kind === "error"
        ? event.detail
        : null;
  return {
    ...(event.agent === "codex" ? { agent: "codex", turnId: event.turnId } : {}),
    source: event.source,
    kind,
    sessionId: event.sessionId,
    detail,
    message: kind === "completed" ? event.message : null,
    observedAt: event.receivedAt,
  };
}

const SESSION_ID_SAFE = /^[A-Za-z0-9._-]{1,128}$/;

/** A `hook:event` payload off the wire, or null for anything malformed. */
export function parseHookEvent(raw: unknown): HookEvent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (
    typeof node.paneId !== "number" ||
    !Number.isSafeInteger(node.paneId) ||
    node.paneId <= 0 ||
    (node.source !== "hook" && node.source !== "server") ||
    typeof node.agent !== "string" ||
    typeof node.event !== "string" ||
    typeof node.sessionId !== "string" ||
    !SESSION_ID_SAFE.test(node.sessionId)
  ) {
    return null;
  }
  return {
    ...(typeof node.turnId === "string" && SESSION_ID_SAFE.test(node.turnId)
      ? { turnId: node.turnId }
      : {}),
    paneId: node.paneId,
    source: node.source,
    agent: node.agent,
    event: node.event,
    sessionId: node.sessionId,
    cwd: typeof node.cwd === "string" ? node.cwd : null,
    message: typeof node.message === "string" && node.message !== "" ? node.message : null,
    detail: typeof node.detail === "string" && node.detail !== "" ? node.detail : null,
    receivedAt:
      typeof node.receivedAt === "number" && Number.isFinite(node.receivedAt) ? node.receivedAt : 0,
  };
}
