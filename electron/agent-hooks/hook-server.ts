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
 * The same listener serves the in-pane `deck` command: a request under `/control/` is handed
 * whole to the optional `control` handler (`electron/control/`), which does its own
 * authorization. Without one, those paths fall through to the hook validator's 404, so a
 * build with the `agentControl` switch off answers them as it always did.
 *
 * Every decision about a request is `hook-request.ts`'s, tested on its own;
 * this file only wires those decisions to `node:http` and to the generation
 * check that drops a post from a pane's previous occupant.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CONTROL_PATH_PREFIX } from "../control/control-auth";
import {
  hookAgentOfUrl,
  hookMaxBodyBytes,
  nextPaneSession,
  parseHookBody,
  validateHookHead,
  type HookPost,
} from "./hook-request";

/** The flat payload the renderer's `hook:event` listener receives (R6). */
export interface HookEventPayload {
  readonly turnId?: string;
  readonly paneId: number;
  readonly source: "hook";
  readonly agent: string;
  readonly event: string;
  readonly sessionId: string;
  readonly cwd: string | null;
  readonly message: string | null;
  readonly detail: string | null;
  readonly receivedAt: number;
}

/** Answers every request whose path starts with `/control/`; it owns that request's whole life. */
export interface ControlHandler {
  handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>;
}

export interface HookServerDeps {
  /** The pane's token, or null when the pane is not live. */
  readonly tokenFor: (paneId: number) => string | null;
  /** The pane's tty (without `/dev/`), or null when the pane is not live. */
  readonly ttyFor: (paneId: number) => string | null;
  /** Deliver to the window that owns the pane. */
  readonly emitToOwner: (paneId: number, payload: HookEventPayload) => void;
  /** The control routes of the in-pane `deck` command; absent while the switch is off. */
  readonly control?: ControlHandler;
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

/** The agents that post to the endpoint; each keeps its own generation on a pane. */
const HOOK_AGENTS = ["claude", "codex", "opencode"] as const;
const generationKey = (paneId: number, agent: string) => `${paneId}:${agent}`;

export function createHookServer(deps: HookServerDeps): HookServer {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.warn(message));
  /**
   * Current occupant per pane AND agent — the generation check's memory. Keyed by agent too, so
   * a nested Codex `SessionStart` cannot evict the pane's Claude occupant.
   */
  const sessions = new Map<string, string | null>();
  let server: http.Server | null = null;
  let port: number | null = null;

  function accept(post: HookPost): void {
    const key = generationKey(post.paneId, post.agent ?? "claude");
    const decision = nextPaneSession(sessions.get(key) ?? null, post);
    sessions.set(key, decision.current);
    if (!decision.accept) {
      log(`Deck: dropped a ${post.event} hook from a previous occupant of pane ${post.paneId}`);
      return;
    }
    deps.emitToOwner(post.paneId, {
      paneId: post.paneId,
      source: "hook",
      agent: post.agent ?? "claude",
      ...(post.turnId === undefined ? {} : { turnId: post.turnId }),
      event: post.event,
      sessionId: post.sessionId,
      cwd: post.cwd,
      message: post.message,
      detail: post.detail,
      receivedAt: now(),
    });
  }

  function handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const control = deps.control;
    if (
      control !== undefined &&
      (request.url ?? "").split("?")[0].startsWith(CONTROL_PATH_PREFIX)
    ) {
      control.handle(request, response).catch((error: unknown) => {
        // The handler answers its own failures; this is the last line, so a rejection can never
        // surface as an unhandled one in main.
        log(`Deck: a control request failed: ${String(error)}`);
        if (!response.headersSent) {
          response.statusCode = 500;
        }
        response.end();
      });
      return;
    }
    const head = validateHookHead(
      { method: request.method, url: request.url, headers: request.headers },
      deps.tokenFor,
      deps.ttyFor,
    );
    if (!head.ok) {
      response.statusCode = head.status;
      response.end();
      request.resume();
      return;
    }
    // The head check passed, so the path is one the endpoint serves.
    const agent = hookAgentOfUrl(request.url) ?? "claude";
    const limit = hookMaxBodyBytes(agent);
    const chunks: Buffer[] = [];
    let received = 0;
    let refused = false;
    request.on("data", (chunk: Buffer) => {
      if (refused) {
        return;
      }
      received += chunk.length;
      if (received > limit) {
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
      const post = parseHookBody(head.paneId, Buffer.concat(chunks).toString("utf8"), agent);
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
      for (const agent of HOOK_AGENTS) sessions.delete(generationKey(paneId, agent));
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
