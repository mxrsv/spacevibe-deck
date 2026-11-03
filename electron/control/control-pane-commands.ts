/**
 * `deck pane open | send | read | close` (spec 2026-11-03-agent-orchestration, ORC11-13, ORC16,
 * ORC23): the commands that act on a pane through the window that owns it.
 *
 * Main decides who may act and on what, validates the arguments and keeps the bookkeeping (who
 * opened which pane, the post-send mark `wait` needs). The window does the typing, the reading,
 * the tab and the close, through the same renderer paths the rest of Deck uses; nothing here
 * writes to a PTY. A value the renderer sends back is only ever reported as one of a closed set
 * of codes, because replies end up printed in a terminal.
 *
 * Status codes follow `control-routes.ts`: 200 done, 400 usage, 403 refused, 409 busy, 422 the
 * command ran and failed with a closed code, 504 the window did not answer in time.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { PANE_ID_PATTERN } from "../agent-hooks/hook-request";
import { stripAnsiSequences } from "../../src/lib/strip-ansi-sequences";
import { sanitizeTerminalPaste } from "../../src/lib/terminal-paste";
import {
  CONTROL_READ_DEFAULT_LINES,
  CONTROL_READ_MAX_LINES,
  CONTROL_REPLY_ERRORS,
  CONTROL_SEND_OUTCOMES,
  type ControlReplyPayload,
  type ControlSendOutcome,
} from "../../src/lib/control-command";
import { parseWorkerEnvelope } from "./envelope";
import { failure, usage, type Command, type Reply } from "./control-reply";
import { commandFields, type ControlForwarder, type ForwardResult } from "./control-forward";
import type { OpenedBy } from "./opened-by";
import type { PaneMirror } from "./pane-mirror";

/**
 * The whole of one `pane open` call, the first prompt included. The shim's curl waits 95 s, so
 * the sum of the open, the wait for the agent and the send stays under it and Deck answers first.
 */
export const OPEN_BUDGET_MS = 90_000;
/** How long `pane open --prompt` waits for the new agent to read idle for the first time. */
export const FIRST_IDLE_CAP_MS = 60_000;
/** A send, a read, or a close that skips the user's confirmation. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** A close without `--force` may sit behind the busy dialog until the user answers it. */
export const CLOSE_CONFIRM_TIMEOUT_MS = 80_000;

const LINES_PATTERN = /^[1-9][0-9]{0,3}$/;
const MAX_NAME_LENGTH = 100;
const MAX_AGENT_LENGTH = 64;
const CONTROL_CHARACTER = /\p{Cc}/u;

export interface PaneCommandDeps {
  readonly forwarder: ControlForwarder;
  readonly openedBy: OpenedBy;
  readonly mirror: PaneMirror;
  /** The label of the window that owns the pane, or null while it is being transferred. */
  readonly windowOf: (paneId: number) => string | null;
  /** Note a send BEFORE it is pushed, so a `wait` needs a turn that began after it (ORC15). */
  readonly markSent: (paneId: number) => void;
  readonly log: (message: string) => void;
  readonly now?: () => number;
  readonly isDirectory?: (target: string) => Promise<boolean>;
}

type Delivery =
  | { readonly ok: true; readonly outcome: "sent" | "pasted" }
  | { readonly ok: false; readonly status: number; readonly error: string };

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** The renderer's word if it is one of ours, so nothing it invents reaches the pane's terminal. */
function closedCode<T extends string>(set: readonly T[], value: string | null): T | null {
  return set.find((member) => member === value) ?? null;
}

function cleanText(text: string): string {
  return sanitizeTerminalPaste(stripAnsiSequences(text));
}

const ERROR_TEXT: Readonly<Record<string, (pane: number) => string>> = {
  "not-an-agent-pane": (pane) => `pane ${pane} does not run an agent`,
  stale: (pane) =>
    `the agent process in pane ${pane} changed after the paste; the text is in the pane, not submitted`,
  busy: (pane) => `pane ${pane} is taking another paste`,
  "no-target": (pane) => `pane ${pane} is not available`,
  failed: (pane) => `the paste into pane ${pane} failed`,
  "empty-text": () => "the text is empty",
  "not-closed": (pane) => `pane ${pane} was not closed`,
  "unknown-agent": () => "that agent is not enabled or not installed",
  "spawn-failed": () => "the tab could not be opened",
  "renderer-timeout": () => "the Deck window did not answer in time",
  "window-gone": () => "the pane's window is gone",
  aborted: () => "the call was cancelled",
};

function refusal(status: number, error: string, pane: number): Reply {
  const describe = ERROR_TEXT[error];
  return failure(status, error, describe === undefined ? error : describe(pane));
}

/** A forward that produced no reply, as the answer the caller reads. */
function forwardRefusal(
  error: Extract<ForwardResult, { ok: false }>["error"],
  pane: number,
): Reply {
  return refusal(error === "renderer-timeout" ? 504 : 422, error, pane);
}

export function createPaneCommands(deps: PaneCommandDeps): Readonly<Record<string, Command>> {
  const now = deps.now ?? Date.now;
  const isDirectory = deps.isDirectory ?? directoryExists;

  /**
   * Type `text` into a pane the caller may act on, through the window that owns it. Shared by
   * `pane send` and the prompt of `pane open`, so there is one path and one set of refusals.
   */
  async function deliverText(
    caller: number,
    target: number,
    text: string,
    submit: boolean,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<Delivery> {
    // ORC23: only a pane main knows to run an agent, and the window re-checks the process.
    const expectedAgent = deps.mirror.get(target)?.agent ?? null;
    if (expectedAgent === null) {
      return { ok: false, status: 422, error: "not-an-agent-pane" };
    }
    deps.markSent(target);
    const result = await deps.forwarder.forward({
      callerPaneId: caller,
      fields: commandFields("send", target, { text, submit, expectedAgent }),
      timeoutMs,
      signal,
    });
    if (!result.ok) {
      return {
        ok: false,
        status: result.error === "renderer-timeout" ? 504 : 422,
        error: result.error,
      };
    }
    const { reply } = result;
    const outcome: ControlSendOutcome | null = closedCode(CONTROL_SEND_OUTCOMES, reply.outcome);
    if (reply.ok && (outcome === "sent" || outcome === "pasted")) {
      return { ok: true, outcome };
    }
    // A failed reply that still says "sent" is the window contradicting itself, not a delivery.
    const failedWith = outcome === "sent" || outcome === "pasted" ? null : outcome;
    return {
      ok: false,
      status: 422,
      error: failedWith ?? closedCode(CONTROL_REPLY_ERRORS, reply.error) ?? "renderer-error",
    };
  }

  /** The target pane named by `id`, or the usage error to answer. */
  function targetOf(args: URLSearchParams): { pane: number } | { reply: Reply } {
    const id = args.get("id") ?? "";
    return PANE_ID_PATTERN.test(id)
      ? { pane: Number(id) }
      : { reply: usage("pane id must be a positive number") };
  }

  /** Whether the caller may run `command` on the target (ORC6-7); self gets its own words. */
  function refuseOutOfScope(
    caller: number,
    target: number,
    command: "send" | "read" | "close",
  ): Reply | null {
    if (target === caller && command !== "read") {
      return failure(
        403,
        "forbidden",
        command === "send" ? "a pane cannot send to itself" : "a pane cannot close itself",
      );
    }
    return deps.openedBy.mayAct(caller, target, command)
      ? null
      : failure(403, "forbidden", "no such pane");
  }

  return {
    "pane/open": async ({ paneId: caller, args, signal }) => {
      const startedAt = now();
      const cwd = args.get("cwd") ?? "";
      const agent = (args.get("agent") ?? "").trim();
      const rawName = args.get("name");
      const rawPrompt = args.get("prompt");
      if (cwd === "") return usage("--cwd is required");
      if (!path.isAbsolute(cwd)) return usage("--cwd must be an absolute path");
      if (agent === "") return usage("--agent is required");
      if (agent.length > MAX_AGENT_LENGTH || CONTROL_CHARACTER.test(agent)) {
        return usage("--agent must be an agent id");
      }
      if (
        rawName !== null &&
        (rawName.length > MAX_NAME_LENGTH || CONTROL_CHARACTER.test(rawName))
      ) {
        return usage(`--name must be a label of at most ${MAX_NAME_LENGTH} characters`);
      }
      const prompt = rawPrompt === null ? null : cleanText(rawPrompt);
      if (prompt !== null && prompt.trim() === "") return usage("--prompt is empty");
      if (!(await isDirectory(cwd))) return usage("--cwd must be an existing directory");

      const window = deps.windowOf(caller);
      /** Records the new pane as the caller's, only when it lives in the caller's window. */
      const adopt = (reply: ControlReplyPayload): boolean => {
        if (!reply.ok || reply.paneId === null) return false;
        if (window === null || deps.windowOf(reply.paneId) !== window) {
          deps.log(
            `Deck: an opened pane ${reply.paneId} is not in pane ${caller}'s window; it is left outside the caller's scope`,
          );
          return false;
        }
        deps.openedBy.record(reply.paneId, caller);
        return true;
      };
      const asked = await deps.forwarder.forward({
        callerPaneId: caller,
        fields: commandFields("open", caller, {
          cwd,
          agent,
          name: rawName === null ? null : rawName.trim(),
        }),
        timeoutMs: OPEN_BUDGET_MS,
        signal,
        // The tab exists even if this call gave up first; whoever opened it must still control it.
        onLate: (reply) => void adopt(reply),
      });
      if (!asked.ok) return forwardRefusal(asked.error, caller);
      const { reply } = asked;
      if (!reply.ok || reply.paneId === null) {
        const error = closedCode(CONTROL_REPLY_ERRORS, reply.error) ?? "renderer-error";
        return refusal(422, error, caller);
      }
      if (!adopt(reply)) return refusal(422, "spawn-failed", caller);
      const child = reply.paneId;
      if (prompt === null) {
        return { status: 200, json: { ok: true, paneId: child }, text: String(child) };
      }

      // ORC11: the prompt goes in once the agent first reads idle, within what is left of the
      // budget; a pane that never gets there stays open and the reply says so.
      const left = OPEN_BUDGET_MS - (now() - startedAt);
      const idle = await deps.mirror.wait(child, "idle", {
        capMs: Math.max(0, Math.min(FIRST_IDLE_CAP_MS, left - REQUEST_TIMEOUT_MS)),
        signal,
      });
      let promptOutcome = "not-idle";
      // Main never types after the caller has gone.
      if (!signal.aborted && idle.reached && idle.state.phase === "idle") {
        const remaining = OPEN_BUDGET_MS - (now() - startedAt);
        const delivery = await deliverText(
          caller,
          child,
          prompt,
          true,
          signal,
          Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remaining)),
        );
        promptOutcome = delivery.ok ? delivery.outcome : delivery.error;
      }
      return {
        status: 200,
        json: { ok: true, paneId: child, prompt: promptOutcome },
        text: `${child}\nprompt: ${promptOutcome}`,
      };
    },

    "pane/send": async ({ paneId: caller, args, signal }) => {
      const target = targetOf(args);
      if ("reply" in target) return target.reply;
      const text = cleanText(args.get("text") ?? "");
      if (text.trim() === "") return usage("the text is empty");
      const refused = refuseOutOfScope(caller, target.pane, "send");
      if (refused !== null) return refused;
      const delivery = await deliverText(
        caller,
        target.pane,
        text,
        args.get("no_submit") !== "1",
        signal,
        REQUEST_TIMEOUT_MS,
      );
      if (!delivery.ok) return refusal(delivery.status, delivery.error, target.pane);
      return {
        status: 200,
        json: { ok: true, outcome: delivery.outcome },
        text: delivery.outcome,
      };
    },

    "pane/read": async ({ paneId: caller, args, signal }) => {
      const target = targetOf(args);
      if ("reply" in target) return target.reply;
      const asked = args.get("lines") ?? String(CONTROL_READ_DEFAULT_LINES);
      if (!LINES_PATTERN.test(asked) || Number(asked) > CONTROL_READ_MAX_LINES) {
        return usage(`--lines must be a number from 1 to ${CONTROL_READ_MAX_LINES}`);
      }
      const envelope = args.get("envelope") === "1";
      const refused = refuseOutOfScope(caller, target.pane, "read");
      if (refused !== null) return refused;
      const result = await deps.forwarder.forward({
        callerPaneId: caller,
        // A block printed above a long answer must not fall outside the rows read.
        fields: commandFields("read", target.pane, {
          lines: envelope ? CONTROL_READ_MAX_LINES : Number(asked),
        }),
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal,
      });
      if (!result.ok) return forwardRefusal(result.error, target.pane);
      const { reply } = result;
      if (!reply.ok || reply.text === null) {
        const error = closedCode(CONTROL_REPLY_ERRORS, reply.error) ?? "renderer-error";
        return refusal(422, error, target.pane);
      }
      // Controls other than newline and tab never reach a terminal that prints this.
      const text = cleanText(reply.text);
      if (!envelope) return { status: 200, json: { ok: true, text }, text };
      const found = parseWorkerEnvelope(text);
      return {
        status: 200,
        json: { ok: true, envelope: found },
        text: found === null ? "none" : JSON.stringify(found),
      };
    },

    "pane/close": async ({ paneId: caller, args, signal }) => {
      const target = targetOf(args);
      if ("reply" in target) return target.reply;
      const force = args.get("force") === "1";
      const refused = refuseOutOfScope(caller, target.pane, "close");
      if (refused !== null) return refused;
      const state = deps.mirror.get(target.pane);
      if (!force && (state?.phase === "working" || state?.attention === "requested")) {
        return {
          status: 409,
          json: {
            ok: false,
            error: "busy",
            phase: state.phase,
            attention: state.attention,
          },
          text: `deck: pane ${target.pane} is ${state.phase === "working" ? "working" : "waiting for you"}; pass --force to close it`,
        };
      }
      const result = await deps.forwarder.forward({
        callerPaneId: caller,
        fields: commandFields("close", target.pane, { force }),
        // Without --force the window may ask the user first, so it gets the time an answer takes.
        timeoutMs: force ? REQUEST_TIMEOUT_MS : CLOSE_CONFIRM_TIMEOUT_MS,
        signal,
      });
      if (!result.ok) return forwardRefusal(result.error, target.pane);
      if (!result.reply.ok) {
        const error = closedCode(CONTROL_REPLY_ERRORS, result.reply.error) ?? "renderer-error";
        return refusal(422, error, target.pane);
      }
      return { status: 200, json: { ok: true }, text: `closed pane ${target.pane}` };
    },
  };
}
