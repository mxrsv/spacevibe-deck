/**
 * opencode's event stream, reduced to the signals the rail reads — pure
 * (agent-signal contract layer, stage 2; spec §4 "Per agent, v1 — opencode").
 *
 * The TUI serves its own HTTP server; launched `opencode --port <n>` the port
 * is known, and `GET /event` streams every event as an SSE frame
 * `data: {"id":"evt_…","type":"…","properties":{…}}` (captured 2026-09-03
 * from opencode 1.18.25: the first frame is `server.connected`). The shapes
 * below are the OpenAPI schemas the same server published at `/doc`:
 *
 * - `session.status`   `{ sessionID, status: { type: "idle" | "busy" | "retry" } }`
 * - `session.idle`     `{ sessionID }`
 * - `session.error`    `{ sessionID?, error }`
 * - `permission.asked` `{ id, sessionID, permission, … }` and the v2 form
 *   `permission.v2.asked` `{ id, sessionID, action, … }` — the docs disagree
 *   on the name (trust audit §5.4), so both are handled, as are both
 *   `*.replied` forms, which clear the ask.
 *
 * Everything else on the stream (`message.*`, `file.*`, `todo.*`, `pty.*`) is
 * not a state and is dropped here.
 */

export type OpencodeSignalKind = "working" | "completed" | "error" | "requested" | "answered";

export interface OpencodeSignal {
  readonly kind: OpencodeSignalKind;
  readonly sessionId: string;
  readonly detail: string | null;
}

const SESSION_ID_SAFE = /^[A-Za-z0-9._-]{1,128}$/;

function sessionIdOf(properties: Record<string, unknown>): string | null {
  const id = properties.sessionID;
  return typeof id === "string" && SESSION_ID_SAFE.test(id) ? id : null;
}

/** One parsed frame → one signal, or null for a frame that is not a state. */
export function opencodeSignalOf(frame: unknown): OpencodeSignal | null {
  if (typeof frame !== "object" || frame === null) {
    return null;
  }
  const node = frame as Record<string, unknown>;
  const type = node.type;
  const properties =
    typeof node.properties === "object" && node.properties !== null
      ? (node.properties as Record<string, unknown>)
      : {};
  if (typeof type !== "string") {
    return null;
  }
  const sessionId = sessionIdOf(properties);
  if (sessionId === null) {
    return null;
  }
  switch (type) {
    case "session.status": {
      const status = properties.status;
      const statusType =
        typeof status === "object" && status !== null
          ? (status as Record<string, unknown>).type
          : undefined;
      if (statusType === "busy" || statusType === "retry") {
        return { kind: "working", sessionId, detail: null };
      }
      if (statusType === "idle") {
        return { kind: "completed", sessionId, detail: null };
      }
      return null;
    }
    case "session.idle":
      return { kind: "completed", sessionId, detail: null };
    case "session.error":
      return { kind: "error", sessionId, detail: errorDetail(properties.error) };
    case "permission.asked":
    case "permission.v2.asked": {
      const detail =
        (typeof properties.permission === "string" && properties.permission) ||
        (typeof properties.action === "string" && properties.action) ||
        null;
      return { kind: "requested", sessionId, detail: detail === null ? "permission" : detail };
    }
    case "permission.replied":
    case "permission.v2.replied":
      return { kind: "answered", sessionId, detail: null };
    default:
      return null;
  }
}

function errorDetail(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const node = error as Record<string, unknown>;
  const name = typeof node.name === "string" ? node.name : null;
  return name;
}

/**
 * An SSE parser over a byte stream. Frames are separated by a blank line; a
 * frame's `data:` lines join with `\n`. `event:`/`id:`/`retry:` fields are
 * ignored — opencode puts everything in `data`. Returns the frames completed
 * by this chunk; the remainder is carried to the next call.
 */
export function createSseParser(): { push(chunk: string): unknown[] } {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const frames: unknown[] = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data !== "") {
          try {
            frames.push(JSON.parse(data));
          } catch {
            // A frame that is not JSON is not one of opencode's; skip it.
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
      // Bound the carry: a frame that never terminates must not grow forever.
      if (buffer.length > 256 * 1024) {
        buffer = "";
      }
      return frames;
    },
  };
}

/** `GET /session/status` → the sessions currently busy, for the connect-time catch-up. */
export function busySessionsOf(statusBody: unknown): string[] {
  if (typeof statusBody !== "object" || statusBody === null || Array.isArray(statusBody)) {
    return [];
  }
  const busy: string[] = [];
  for (const [sessionId, status] of Object.entries(statusBody as Record<string, unknown>)) {
    if (!SESSION_ID_SAFE.test(sessionId) || typeof status !== "object" || status === null) {
      continue;
    }
    const type = (status as Record<string, unknown>).type;
    if (type === "busy" || type === "retry") {
      busy.push(sessionId);
    }
  }
  return busy;
}
