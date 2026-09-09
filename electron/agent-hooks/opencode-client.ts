/**
 * One opencode server per pane, subscribed from main (agent-signal contract
 * layer, stage 2; spec §4 "Per agent, v1 — opencode").
 *
 * The renderer reserves a port for a pane before it types
 * `opencode --port <n>` (`opencode_attach`), and this module keeps trying to
 * connect to it — the TUI takes a moment to come up — then holds one SSE
 * subscription on `GET /event` for the pane's life. Every state event is
 * pushed to the pane's window as the same flat `hook:event` a Claude hook
 * post uses, with `source: "server"`.
 *
 * The port comes from binding an ephemeral listener and releasing it — the
 * classic reservation race, accepted: a collision means opencode fails to
 * bind, prints so, and the pane stays on the fallback, drawn as inferred.
 */
import http from "node:http";
import net from "node:net";
import { busySessionsOf, createSseParser, opencodeSignalOf } from "./opencode-events";
import type { HookEventPayload } from "./hook-server";

export const OPENCODE_CONNECT_RETRY_MS = 1000;
export const OPENCODE_CONNECT_GIVE_UP_MS = 90_000;
const OPENCODE_HOST = "127.0.0.1";
const STATUS_TIMEOUT_MS = 3000;

export interface OpencodeClientDeps {
  readonly emitToOwner: (paneId: number, payload: HookEventPayload) => void;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
  /** Test seam: the port a pane is attached on; defaults to a loopback reservation. */
  readonly reservePort?: () => Promise<number | null>;
  /** Test seam: the reconnect interval. */
  readonly retryMs?: number;
}

export interface OpencodeClients {
  /** Reserve a port for the pane and start connecting; answers the port, or null. */
  attach(paneId: number): Promise<number | null>;
  /** Drop the pane's subscription and stop retrying. */
  detach(paneId: number): void;
  closeAll(): void;
}

interface Attachment {
  readonly port: number;
  request: http.ClientRequest | null;
  retry: ReturnType<typeof setTimeout> | null;
  readonly startedAt: number;
  /**
   * The stream answered 200 at least once. The give-up deadline is about the
   * INITIAL connect — a TUI that never came up — and must not delete a
   * long-running pane's attachment the first time its stream hiccups.
   */
  connected: boolean;
  closed: boolean;
}

/** Bind port 0 on loopback, read the number, release it. */
export function reserveLoopbackPort(): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.listen(0, OPENCODE_HOST, () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : null;
      probe.close(() => resolve(port));
    });
  });
}

function readJson(port: number, pathname: string): Promise<unknown> {
  return new Promise((resolve) => {
    const request = http.get(
      { host: OPENCODE_HOST, port, path: pathname, timeout: STATUS_TIMEOUT_MS },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(null);
          }
        });
        response.on("error", () => resolve(null));
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

export function createOpencodeClients(deps: OpencodeClientDeps): OpencodeClients {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.warn(message));
  const reservePort = deps.reservePort ?? reserveLoopbackPort;
  const retryMs = deps.retryMs ?? OPENCODE_CONNECT_RETRY_MS;
  const attachments = new Map<number, Attachment>();

  function emit(paneId: number, event: string, sessionId: string, detail: string | null): void {
    deps.emitToOwner(paneId, {
      paneId,
      source: "server",
      agent: "opencode",
      event,
      sessionId,
      cwd: null,
      message: null,
      detail,
      receivedAt: now(),
    });
  }

  function scheduleRetry(paneId: number, attachment: Attachment): void {
    if (attachment.closed || attachment.retry !== null) {
      return;
    }
    if (!attachment.connected && now() - attachment.startedAt > OPENCODE_CONNECT_GIVE_UP_MS) {
      log(`Deck: gave up connecting to opencode for pane ${paneId} on port ${attachment.port}`);
      attachments.delete(paneId);
      return;
    }
    attachment.retry = setTimeout(() => {
      attachment.retry = null;
      connect(paneId, attachment);
    }, retryMs);
  }

  function connect(paneId: number, attachment: Attachment): void {
    if (attachment.closed) {
      return;
    }
    const parser = createSseParser();
    const request = http.get(
      {
        host: OPENCODE_HOST,
        port: attachment.port,
        path: "/event",
        headers: { Accept: "text/event-stream" },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          scheduleRetry(paneId, attachment);
          return;
        }
        attachment.connected = true;
        // Connected: catch up on what is already busy, so a session that
        // started before this subscription is not drawn idle until its next
        // event.
        void readJson(attachment.port, "/session/status").then((status) => {
          for (const sessionId of busySessionsOf(status)) {
            emit(paneId, "session.status", sessionId, null);
          }
        });
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          for (const frame of parser.push(chunk)) {
            const signal = opencodeSignalOf(frame);
            if (signal === null) {
              continue;
            }
            const type =
              typeof frame === "object" && frame !== null
                ? String((frame as Record<string, unknown>).type)
                : "unknown";
            emit(paneId, type, signal.sessionId, signal.detail);
          }
        });
        response.on("end", () => scheduleRetry(paneId, attachment));
        response.on("error", () => scheduleRetry(paneId, attachment));
      },
    );
    request.on("error", () => scheduleRetry(paneId, attachment));
    attachment.request = request;
  }

  return {
    async attach(paneId) {
      const existing = attachments.get(paneId);
      if (existing !== undefined) {
        return existing.port;
      }
      const port = await reservePort();
      if (port === null) {
        return null;
      }
      const attachment: Attachment = {
        port,
        request: null,
        retry: null,
        startedAt: now(),
        connected: false,
        closed: false,
      };
      attachments.set(paneId, attachment);
      connect(paneId, attachment);
      return port;
    },
    detach(paneId) {
      const attachment = attachments.get(paneId);
      if (attachment === undefined) {
        return;
      }
      attachment.closed = true;
      if (attachment.retry !== null) {
        clearTimeout(attachment.retry);
      }
      attachment.request?.destroy();
      attachments.delete(paneId);
    },
    closeAll() {
      for (const paneId of [...attachments.keys()]) {
        this.detach(paneId);
      }
    },
  };
}
