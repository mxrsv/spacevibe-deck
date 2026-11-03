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
import { authorizeControlHead, CONTROL_CALL_CAP_MS, CONTROL_MAX_BODY_BYTES } from "./control-auth";
import { createOpenedBy } from "./opened-by";
import type { PaneMirror, PaneSnapshot, WaitTarget } from "./pane-mirror";

/** What `pane wait` waits for when the call names no timeout (ORC14). */
const DEFAULT_WAIT_SECONDS = 600;
const MAX_WAIT_SECONDS = 3600;
const WAIT_TARGETS: readonly WaitTarget[] = ["idle", "needs-you", "exited", "turn"];
const TIMEOUT_PATTERN = /^[1-9][0-9]{0,3}$/;
/** A value printed into a terminal: control characters, escape sequences included, become `?`. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

export interface ControlPane {
  readonly paneId: number;
  readonly cwd: string | null;
}

export interface ControlRouterDeps {
  /** The pane's token, or null when the pane is not live. */
  readonly tokenFor: (paneId: number) => string | null;
  /** The pane's tty (without `/dev/`), or null when the pane is not live. */
  readonly ttyFor: (paneId: number) => string | null;
  readonly version: () => string;
  /** The label of the window that owns the pane, or null while it is being transferred. */
  readonly windowOf: (paneId: number) => string | null;
  readonly addWorktree: (params: WorktreeAddParams) => Promise<WorktreeAddResult>;
  /** The renderer's reports of each pane's phase and attention (ORC17). */
  readonly mirror: PaneMirror;
  /** The live panes of a window with their working directories, read in main. */
  readonly panesOf: (window: string) => readonly ControlPane[];
  /** Refusals are logged with the pane id and a reason, never the token. */
  readonly log: (message: string) => void;
}

export interface ControlRouter {
  handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>;
  /** Forget what the router knows about a pane once its PTY is gone. */
  forgetPane(paneId: number): void;
  /** Record that `openerPaneId` opened `childPaneId` (ORC6), which puts the child in its scope. */
  recordOpened(childPaneId: number, openerPaneId: number): void;
  /**
   * Note that text is about to be sent to a pane (ORC15). Call it BEFORE the paste: from then
   * on a `wait` on that pane ignores the state that preceded the send and needs a turn that
   * started after it.
   */
  markSent(paneId: number): void;
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
  /** Aborts when the caller hangs up before the reply, so a held call lets go of its timers. */
  readonly signal: AbortSignal;
}

type Command = (context: CommandContext) => Reply | Promise<Reply>;

/** Commands the spec names that a later slice builds; they answer `not-implemented` until then. */
const PLANNED_COMMANDS: ReadonlySet<string> = new Set([
  "pane/open",
  "pane/send",
  "pane/read",
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

function printable(value: string): string {
  return value.replace(CONTROL_CHARACTERS, "?");
}

/** What a caller reads of a pane's state; a pane main has no report for reads as unknown. */
function stateFields(state: PaneSnapshot | null) {
  return {
    phase: state?.phase ?? "unknown",
    attention: state?.attention ?? "none",
    confidence: state?.confidence ?? "unknown",
    agent: state?.agent ?? null,
  } as const;
}

function stateText(fields: ReturnType<typeof stateFields>): string {
  return `${fields.phase}, attention ${fields.attention}, confidence ${fields.confidence}`;
}

/** Pad every column but the last to its widest cell, so a pane per line reads as a table. */
function alignedRows(rows: ReadonlyArray<readonly string[]>): string {
  const widths = rows[0].map((_cell, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
        .join("  "),
    )
    .join("\n");
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
  /** The pane's report revision at its latest send; a `wait` needs a turn that began after it. */
  const sentAtRevision = new Map<number, number>();

  const refused = (request: http.IncomingMessage, paneId: number | null, reason: string) =>
    deps.log(
      `Deck: refused a control request from pane ${paneId === null ? claimedPane(request) : paneId}: ${reason}`,
    );

  const commands: Readonly<Record<string, Command>> = {
    status: ({ paneId }) => {
      const version = deps.version();
      const window = deps.windowOf(paneId);
      // ORC8: only an agent pane with a known agent may open other panes.
      const canOpen = (deps.mirror.get(paneId)?.agent ?? null) !== null;
      return {
        status: 200,
        json: { ok: true, version, paneId, window, switch: "on", canOpen },
        text: [
          `Deck ${version}`,
          `pane ${paneId} in window ${window ?? "none"}`,
          "agent control: on",
          `can open panes: ${canOpen ? "yes" : "no"}`,
        ].join("\n"),
      };
    },
    "pane/list": ({ paneId }) => {
      const window = deps.windowOf(paneId);
      const panes = (window === null ? [] : [...deps.panesOf(window)])
        .sort((a, b) => a.paneId - b.paneId)
        .map((pane) => {
          const fields = stateFields(deps.mirror.get(pane.paneId));
          return {
            paneId: pane.paneId,
            agent: fields.agent ?? "shell",
            phase: fields.phase,
            attention: fields.attention,
            confidence: fields.confidence,
            cwd: pane.cwd,
            mine: openedBy.openedBy(paneId, pane.paneId),
          };
        });
      const text =
        panes.length === 0
          ? "deck: no panes in this window"
          : alignedRows(
              panes.map((pane) => [
                String(pane.paneId),
                printable(pane.agent),
                pane.phase,
                pane.attention,
                pane.confidence,
                pane.mine ? "mine" : "-",
                pane.cwd === null ? "-" : printable(pane.cwd),
              ]),
            );
      return { status: 200, json: { ok: true, panes }, text };
    },
    "pane/wait": async ({ paneId: caller, args, signal }) => {
      const id = args.get("id") ?? "";
      if (!PANE_ID_PATTERN.test(id)) return usage("pane id must be a positive number");
      const target = WAIT_TARGETS.find((candidate) => candidate === args.get("for"));
      if (target === undefined) return usage("--for must be idle, needs-you, exited or turn");
      const asked = args.get("timeout") ?? String(DEFAULT_WAIT_SECONDS);
      if (!TIMEOUT_PATTERN.test(asked) || Number(asked) > MAX_WAIT_SECONDS) {
        return usage(`--timeout must be a number of seconds from 1 to ${MAX_WAIT_SECONDS}`);
      }
      const targetPane = Number(id);
      // The same answer as a pane that does not exist (ORC6): a worker learns nothing of panes
      // it did not open.
      if (!openedBy.mayAct(caller, targetPane, "wait"))
        return failure(403, "forbidden", "no such pane");
      const remainingMs = Number(asked) * 1000;
      const afterRevision = sentAtRevision.get(targetPane);
      const result = await deps.mirror.wait(targetPane, target, {
        capMs: Math.min(remainingMs, CONTROL_CALL_CAP_MS),
        ...(afterRevision === undefined ? {} : { afterRevision }),
        signal,
      });
      if (result.reached) {
        const fields = stateFields(result.state);
        return {
          status: 200,
          json: { ok: true, reached: true, ...fields },
          text: `pane ${targetPane}: ${stateText(fields)}`,
        };
      }
      switch (result.reason) {
        case "no-turn": {
          const fields = stateFields(deps.mirror.get(targetPane));
          return {
            status: 200,
            json: { ok: true, reached: false, reason: "no-turn", ...fields },
            text: `pane ${targetPane}: no turn started after the send; ${stateText(fields)}`,
          };
        }
        case "gone":
          return failure(422, "pane-gone", `pane ${targetPane} is gone`);
        case "cap":
          // The shim asks again with what is left; only the last slice may time out.
          return remainingMs > CONTROL_CALL_CAP_MS
            ? { status: 202, json: { ok: false, pending: true }, text: "deck: still waiting" }
            : failure(408, "timeout", `timed out waiting for pane ${targetPane}`);
      }
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
    // A `wait` holds the call for up to a minute; a caller that hangs up (Ctrl+C in the pane)
    // must not leave its timers and waiter behind.
    const hangup = new AbortController();
    response.once("close", () => {
      if (!response.writableFinished) hangup.abort();
    });
    const reply = await command({ paneId: head.paneId, args, signal: hangup.signal });
    if (hangup.signal.aborted) return;
    if (reply.status === 400) refused(request, head.paneId, "usage");
    // A scope refusal reads like a missing pane to the caller; the log keeps the difference.
    if (reply.status === 403) refused(request, head.paneId, "outside the caller's scope");
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
      sentAtRevision.delete(paneId);
    },
    recordOpened(childPaneId, openerPaneId) {
      openedBy.record(childPaneId, openerPaneId);
    },
    markSent(paneId) {
      sentAtRevision.set(paneId, deps.mirror.revisionOf(paneId));
    },
  };
}
