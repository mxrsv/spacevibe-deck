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
 * 404 unknown, 409 busy, 413 oversize, 422 the command ran and failed with a closed code, 504 the
 * window that owns a pane did not answer. `open`, `send`, `read` and `close` are in
 * `control-pane-commands.ts`; they reach the renderer through `control-forward.ts`.
 */
import type http from "node:http";
import path from "node:path";
import type { WorktreeAddParams, WorktreeAddResult } from "../git/worktree";
import { PANE_ID_PATTERN, HEADER_PANE } from "../agent-hooks/hook-request";
import type { ControlReplyPayload } from "../../src/lib/control-command";
import { authorizeControlHead, CONTROL_CALL_CAP_MS, CONTROL_MAX_BODY_BYTES } from "./control-auth";
import { createControlForwarder } from "./control-forward";
import { createPaneCommands } from "./control-pane-commands";
import { failure, usage, type Command, type Reply } from "./control-reply";
import { ORCHESTRATE_SKILL } from "./orchestrate-skill";
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
  /** Push an event to the window that owns the pane (`WindowCoordinator.deliver`). */
  readonly deliver: (paneId: number, event: string, payload: unknown) => void;
  readonly addWorktree: (params: WorktreeAddParams) => Promise<WorktreeAddResult>;
  /** The renderer's reports of each pane's phase and attention (ORC17). */
  readonly mirror: PaneMirror;
  /** The live panes of a window with their working directories, read in main. */
  readonly panesOf: (window: string) => readonly ControlPane[];
  /** Refusals are logged with the pane id and a reason, never the token. */
  readonly log: (message: string) => void;
  /**
   * The clock a send is stamped with and a command's deadline is read from. It must be the
   * mirror's clock, which a wait compares the stamp against; both default to `Date.now`.
   */
  readonly now?: () => number;
}

export interface ControlRouter {
  handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>;
  /** Forget what the router knows about a pane once its PTY is gone. */
  forgetPane(paneId: number): void;
  /** Record that `openerPaneId` opened `childPaneId` (ORC6), which puts the child in its scope. */
  recordOpened(childPaneId: number, openerPaneId: number): void;
  /**
   * Note that text is about to be sent to a pane (ORC15). Call it BEFORE the paste: from then
   * on an `idle` or `turn` wait on that pane ignores the state that preceded the send and needs
   * a turn that started after it. Sends to one pane are serialized by the caller, so the mark is
   * taken when that send starts, not when it was asked for.
   */
  markSent(paneId: number): void;
  /**
   * Hand a window's `control_reply` to the request it answers. False when the request is unknown
   * or expired, or `fromWindow` is not the window it was pushed to.
   */
  settleReply(fromWindow: string, reply: ControlReplyPayload): boolean;
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
  const now = deps.now ?? Date.now;
  /**
   * The pane's report revision and the time of its latest send. An `idle` or `turn` wait needs a
   * turn that began after the revision, and gives the agent until the time plus `NO_TURN_MS`.
   */
  const lastSend = new Map<number, { readonly revision: number; readonly at: number }>();
  const forwarder = createControlForwarder({
    deliver: deps.deliver,
    windowOf: deps.windowOf,
    log: deps.log,
    now,
  });
  const markSent = (paneId: number): void => {
    lastSend.set(paneId, { revision: deps.mirror.revisionOf(paneId), at: now() });
  };

  const refused = (request: http.IncomingMessage, paneId: number | null, reason: string) =>
    deps.log(
      `Deck: refused a control request from pane ${paneId === null ? claimedPane(request) : paneId}: ${reason}`,
    );

  const commands: Readonly<Record<string, Command>> = {
    status: ({ paneId }) => {
      const version = deps.version();
      const window = deps.windowOf(paneId);
      // ORC8: any authenticated pane may open, as long as its window is there to open in.
      const canOpen = window !== null;
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
      // Only `idle` and `turn` can be answered by the state that preceded a send, so only they
      // need the guard against it. `exited` and `needs-you` keep their strict meaning and never
      // answer "no turn": an exit does not depend on the agent having taken one.
      const sent = target === "idle" || target === "turn" ? lastSend.get(targetPane) : undefined;
      const result = await deps.mirror.wait(targetPane, target, {
        capMs: Math.min(remainingMs, CONTROL_CALL_CAP_MS),
        ...(sent === undefined ? {} : { afterRevision: sent.revision, sentAt: sent.at }),
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
    ...createPaneCommands({
      forwarder,
      openedBy,
      mirror: deps.mirror,
      windowOf: deps.windowOf,
      markSent,
      log: deps.log,
    }),
    "skill/orchestrate": () => ({
      status: 200,
      json: { ok: true, text: ORCHESTRATE_SKILL },
      text: ORCHESTRATE_SKILL,
    }),
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
    // The head was authorized before the body arrived, and a caller can hold the body back for as
    // long as it likes. A pane that closed in the meantime has no standing left: its request must
    // not run, whatever the head said.
    if (deps.tokenFor(head.paneId) === null) {
      refused(request, head.paneId, "pane closed before the body arrived");
      sendReply(response, failure(403, "forbidden", "no such pane"), json);
      return;
    }
    const command = commands[head.command];
    if (command === undefined) {
      refused(request, head.paneId, "unknown command");
      sendReply(response, failure(404, "unknown-command", "unknown command"), json);
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
    if (reply.status === 409) refused(request, head.paneId, "busy");
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
      lastSend.delete(paneId);
      forwarder.forgetCaller(paneId);
    },
    recordOpened(childPaneId, openerPaneId) {
      openedBy.record(childPaneId, openerPaneId);
    },
    markSent,
    settleReply(fromWindow, reply) {
      return forwarder.settle(fromWindow, reply);
    },
  };
}
