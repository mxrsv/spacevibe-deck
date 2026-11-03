/**
 * The control routes the in-pane `deck` command calls (spec 2026-11-03-agent-orchestration).
 *
 * The hook listener hands every `/control/` request here. `control-auth.ts` decides who may
 * call; this file reads the form-encoded arguments the shim built with `curl --data-urlencode`,
 * runs the command and answers either `text/plain` (a few lines for a human reading the pane) or,
 * when the body carries `json=1`, one JSON object that always has `ok`. A refusal made before the
 * body is read cannot know which was wanted, so it is always JSON.
 *
 * Status codes are the shim's whole contract with this file: 200 done, 400 usage, 403 refused,
 * 404 unknown or not built yet, 413 oversize, 422 the command ran and failed with a closed code.
 * Commands that need the renderer or the phase mirror are listed in `PLANNED_COMMANDS` and
 * answer 404 `not-implemented` until their slice lands.
 */
import type http from "node:http";
import path from "node:path";
import type { WorktreeAddParams, WorktreeAddResult } from "../git/worktree";
import { PANE_ID_PATTERN, HEADER_PANE } from "../agent-hooks/hook-request";
import { authorizeControlHead, CONTROL_MAX_BODY_BYTES } from "./control-auth";
import { createOpenedBy } from "./opened-by";

export interface ControlRouterDeps {
  /** The pane's token, or null when the pane is not live. */
  readonly tokenFor: (paneId: number) => string | null;
  /** The pane's tty (without `/dev/`), or null when the pane is not live. */
  readonly ttyFor: (paneId: number) => string | null;
  readonly version: () => string;
  /** The label of the window that owns the pane, or null while it is being transferred. */
  readonly windowOf: (paneId: number) => string | null;
  readonly addWorktree: (params: WorktreeAddParams) => Promise<WorktreeAddResult>;
  /** Refusals are logged with the pane id and a reason, never the token. */
  readonly log: (message: string) => void;
}

export interface ControlRouter {
  handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>;
  /** Forget what the router knows about a pane once its PTY is gone. */
  forgetPane(paneId: number): void;
}

type ControlJson = { readonly ok: boolean } & Readonly<Record<string, unknown>>;

interface Reply {
  readonly status: number;
  readonly json: ControlJson;
  readonly text: string;
}

interface CommandContext {
  readonly paneId: number;
  readonly args: URLSearchParams;
}

type Command = (context: CommandContext) => Reply | Promise<Reply>;

/** Commands the spec names that a later slice builds; they answer `not-implemented` until then. */
const PLANNED_COMMANDS: ReadonlySet<string> = new Set([
  "pane/list",
  "pane/open",
  "pane/send",
  "pane/read",
  "pane/wait",
  "pane/close",
  "skill/orchestrate",
]);

function usage(message: string): Reply {
  return {
    status: 400,
    json: { ok: false, error: "usage", message },
    text: `deck: ${message}`,
  };
}

function failure(status: number, error: string, text: string): Reply {
  return { status, json: { ok: false, error }, text: `deck: ${text}` };
}

/** `a/b` becomes `a-b`; a branch is a path of refs, a folder name is one segment. */
function folderOfBranch(branch: string): string {
  return branch.replace(/\//g, "-");
}

async function readBody(
  request: http.IncomingMessage,
): Promise<{ ok: true; text: string } | { ok: false; error: "too-large" | "aborted" }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const settle = (
      result: { ok: true; text: string } | { ok: false; error: "too-large" | "aborted" },
    ) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > CONTROL_MAX_BODY_BYTES) {
        // Stop buffering at the cap; the caller answers 413 and cuts the connection.
        settle({ ok: false, error: "too-large" });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => settle({ ok: true, text: Buffer.concat(chunks).toString("utf8") }));
    request.on("error", () => settle({ ok: false, error: "aborted" }));
    request.on("close", () => settle({ ok: false, error: "aborted" }));
  });
}

function send(response: http.ServerResponse, status: number, payload: string, json: boolean) {
  response.statusCode = status;
  response.setHeader(
    "content-type",
    json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
  );
  response.end(`${payload}\n`);
}

function sendReply(response: http.ServerResponse, reply: Reply, json: boolean) {
  send(response, reply.status, json ? JSON.stringify(reply.json) : reply.text, json);
}

/** The pane a request claims, for the log; only a well-formed id is ever printed. */
function claimedPane(request: http.IncomingMessage): string {
  const header = request.headers[HEADER_PANE];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && PANE_ID_PATTERN.test(value) ? value : "unknown";
}

export function createControlRouter(deps: ControlRouterDeps): ControlRouter {
  const openedBy = createOpenedBy();

  const refused = (request: http.IncomingMessage, paneId: number | null, reason: string) =>
    deps.log(
      `Deck: refused a control request from pane ${paneId === null ? claimedPane(request) : paneId}: ${reason}`,
    );

  const commands: Readonly<Record<string, Command>> = {
    status: ({ paneId }) => {
      const version = deps.version();
      const window = deps.windowOf(paneId);
      return {
        status: 200,
        json: { ok: true, version, paneId, window, switch: "on" },
        text: [
          `Deck ${version}`,
          `pane ${paneId} in window ${window ?? "none"}`,
          "agent control: on",
        ].join("\n"),
      };
    },
    "worktree/create": async ({ args }) => {
      const repo = args.get("repo") ?? "";
      const branch = args.get("branch") ?? "";
      const dest = args.get("dest") ?? "";
      if (repo === "") return usage("--repo is required");
      if (!path.isAbsolute(repo)) return usage("--repo must be an absolute path");
      if (branch === "") return usage("--branch is required");
      if (dest !== "" && !path.isAbsolute(dest)) return usage("--dest must be an absolute path");
      // Resolved first: `/work/app/.` would otherwise put the default destination inside the repo.
      const repoPath = path.resolve(repo);
      const folder = folderOfBranch(branch);
      if (dest === "" && (folder.trim() === "" || folder === "." || folder === "..")) {
        return usage("that branch name cannot name a folder; pass --dest");
      }
      const destPath = dest === "" ? path.join(path.dirname(repoPath), folder) : path.resolve(dest);
      const result = await deps.addWorktree({ repoPath, branch, destPath });
      if (!result.ok) {
        return failure(422, result.error, `could not create the worktree (${result.error})`);
      }
      return { status: 200, json: { ok: true, path: result.path }, text: result.path };
    },
  };

  async function dispatch(request: http.IncomingMessage, response: http.ServerResponse) {
    const head = authorizeControlHead(
      { method: request.method, url: request.url, headers: request.headers },
      deps.tokenFor,
      deps.ttyFor,
    );
    if (!head.ok) {
      refused(request, head.paneId, head.reason);
      send(response, head.status, JSON.stringify({ ok: false, error: head.error }), true);
      request.resume();
      return;
    }
    const body = await readBody(request);
    if (!body.ok) {
      refused(request, head.paneId, body.error);
      if (body.error === "too-large") {
        response.setHeader("connection", "close");
        send(response, 413, JSON.stringify({ ok: false, error: "too-large" }), true);
        // Cut the stream once the answer is out; the rest of the body is never read.
        response.once("finish", () => request.destroy());
      }
      return;
    }
    const args = new URLSearchParams(body.text);
    const json = args.get("json") === "1";
    const command = commands[head.command];
    if (command === undefined) {
      const planned = PLANNED_COMMANDS.has(head.command);
      refused(request, head.paneId, planned ? "not implemented" : "unknown command");
      sendReply(
        response,
        planned
          ? failure(
              404,
              "not-implemented",
              `${head.command.replace("/", " ")} is not implemented yet`,
            )
          : failure(404, "unknown-command", "unknown command"),
        json,
      );
      return;
    }
    const reply = await command({ paneId: head.paneId, args });
    if (reply.status === 400) refused(request, head.paneId, "usage");
    sendReply(response, reply, json);
  }

  return {
    async handle(request, response) {
      try {
        await dispatch(request, response);
      } catch (error) {
        deps.log(`Deck: a control request failed: ${String(error)}`);
        if (!response.headersSent) {
          send(response, 500, JSON.stringify({ ok: false, error: "internal" }), true);
        } else {
          response.end();
        }
      }
    },
    forgetPane(paneId) {
      openedBy.forget(paneId);
    },
  };
}
