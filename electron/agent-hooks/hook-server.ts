/**
 * The loopback hook endpoint (agent-signal contract layer, stage 2; spec §4).
 *
 * A CLI hook Deck installed for a pane posts its stdin payload here, and the
 * accepted post goes to the renderer that owns the pane as one flat
 * `hook:event`. The listener binds `127.0.0.1` on an OS-chosen port, which
 * every pane's shell learns as `DECK_HOOK_PORT`; if the bind fails, no pane
 * learns a port and every hook script exits 0 without posting — the rail then
 * falls back to the process table and OSC, drawn as inferred.
 *
 * Every decision about a request is `hook-request.ts`'s, tested on its own;
 * this file only wires those decisions to `node:http` and to the generation
 * check that drops a post from a pane's previous occupant.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  HOOK_MAX_BODY_BYTES,
  nextPaneSession,
  parseHookBody,
  validateHookHead,
  type HookPost,
} from "./hook-request";

/** The flat payload the renderer's `hook:event` listener receives (R6). */
export interface HookEventPayload {
  readonly paneId: number;
  /** `hook` for a CLI hook post, `server` for opencode's own event stream. */
  readonly source: "hook" | "server";
  readonly agent: string;
  readonly event: string;
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly message: string | null;
  readonly detail: string | null;
  readonly receivedAt: number;
}

export interface HookServerDeps {
  /** The pane's token, or null when the pane is not live. */
  readonly tokenFor: (paneId: number) => string | null;
  /** Deliver to the window that owns the pane. */
  readonly emitToOwner: (paneId: number, payload: HookEventPayload) => void;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

export interface HookServer {
  /** Bind; resolves the port, or null when the loopback listener could not start. */
  listen(): Promise<number | null>;
  /** The bound port, or null before `listen` / after a failure. */
  port(): number | null;
  /** Forget a pane's generation once its PTY is gone. */
  forgetPane(paneId: number): void;
  close(): Promise<void>;
}

export function createHookServer(deps: HookServerDeps): HookServer {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.warn(message));
  /** Current occupant per pane — the generation check's memory. */
  const sessions = new Map<number, string | null>();
  let server: http.Server | null = null;
  let port: number | null = null;

  function accept(post: HookPost): void {
    const decision = nextPaneSession(sessions.get(post.paneId) ?? null, post);
    sessions.set(post.paneId, decision.current);
    if (!decision.accept) {
      log(`Deck: dropped a ${post.event} hook from a previous occupant of pane ${post.paneId}`);
      return;
    }
    deps.emitToOwner(post.paneId, {
      paneId: post.paneId,
      source: "hook",
      agent: "claude",
      event: post.event,
      sessionId: post.sessionId,
      cwd: post.cwd,
      message: post.message,
      detail: post.detail,
      receivedAt: now(),
    });
  }

  function handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const head = validateHookHead(
      { method: request.method, url: request.url, headers: request.headers },
      deps.tokenFor,
    );
    if (!head.ok) {
      response.statusCode = head.status;
      response.end();
      request.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let refused = false;
    request.on("data", (chunk: Buffer) => {
      if (refused) {
        return;
      }
      received += chunk.length;
      if (received > HOOK_MAX_BODY_BYTES) {
        // Cut the stream rather than buffer to the end and refuse afterwards.
        refused = true;
        response.statusCode = 413;
        response.end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (refused) {
        return;
      }
      const post = parseHookBody(head.paneId, Buffer.concat(chunks).toString("utf8"));
      if (post === null) {
        response.statusCode = 400;
        response.end();
        return;
      }
      response.statusCode = 204;
      response.end();
      accept(post);
    });
    request.on("error", () => {
      if (!response.headersSent) {
        response.statusCode = 400;
        response.end();
      }
    });
  }

  return {
    listen() {
      return new Promise((resolve) => {
        const candidate = http.createServer(handle);
        candidate.on("error", (error) => {
          log(`Deck: the hook endpoint could not listen: ${String(error)}`);
          server = null;
          port = null;
          resolve(null);
        });
        candidate.listen(0, "127.0.0.1", () => {
          const address = candidate.address() as AddressInfo | null;
          server = candidate;
          port = address?.port ?? null;
          resolve(port);
        });
      });
    },
    port() {
      return port;
    },
    forgetPane(paneId) {
      sessions.delete(paneId);
    },
    close() {
      return new Promise((resolve) => {
        const current = server;
        server = null;
        port = null;
        if (current === null) {
          resolve();
          return;
        }
        current.close(() => resolve());
      });
    },
  };
}
