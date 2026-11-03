import {
  CONTROL_READ_DEFAULT_LINES,
  CONTROL_READ_MAX_LINES,
  CONTROL_SUBMIT_DELAY_MS,
  parseControlCommand,
  type ControlCommandPayload,
  type ControlReplyError,
  type ControlReplyPayload,
} from "../lib/control-command";
import { lastRows, stripAnsiSequences } from "../lib/strip-ansi-sequences";
import { sanitizeTerminalPaste } from "../lib/terminal-paste";
import type { InjectOptions, InjectOutcome } from "../prompts/inject";

/**
 * The window's side of the in-pane `deck` command (spec 2026-11-03-agent-orchestration, ORC11-13,
 * ORC16, ORC23): main pushes one `control:command` for a pane this window owns, this module does
 * what it says through the tab manager's own paths and answers once.
 *
 * Nothing here types, reads or closes by itself. `send` is the Prompt Board's paste-then-gated-
 * Enter with two stricter conditions (a pause before the gate, and the same agent process), `read`
 * is the Agent Board's serializer, `close` is the rail's close. The one thing this module owns is
 * the order of sends to one pane: a second send waits for the first, never overlaps it, and never
 * comes back as `busy` because of it.
 *
 * Every command is answered, whatever goes wrong inside it, and every answer carries every key.
 */

export type OpenAgentTabResult =
  | { readonly ok: true; readonly paneId: number }
  | { readonly ok: false; readonly error: "unknown-agent" | "spawn-failed" };

/** What the handler needs from the tab manager, and nothing else. */
export interface ControlTabs {
  /** A new tab at `cwd` running `agent`; resolves once the first pane's PTY exists. */
  openAgentTab(input: {
    readonly cwd: string;
    readonly agent: string;
    readonly name: string | null;
  }): Promise<OpenAgentTabResult>;
  /** The agent process in a pane, read fresh; null for a pane this window does not hold. */
  agentProcessOf(
    paneId: number,
  ): Promise<{ readonly agent: string | null; readonly processId: number | null } | null>;
  injectIntoPane(paneId: number, text: string, opts: InjectOptions): Promise<InjectOutcome>;
  serializePane(paneId: number, lines: number): string | null;
  closePaneById(
    paneId: number,
    opts: { readonly force: boolean },
  ): Promise<"closed" | "declined" | "no-target">;
}

export interface ControlCommandHandler {
  /** Run one pushed command and answer it; never rejects. */
  handle(payload: unknown): Promise<void>;
}

interface AnswerFields {
  readonly ok: boolean;
  readonly paneId?: number;
  readonly text?: string;
  readonly outcome?: string;
  readonly error?: string;
}

function answer(requestId: string, fields: AnswerFields): ControlReplyPayload {
  return {
    requestId,
    ok: fields.ok,
    paneId: fields.paneId ?? null,
    text: fields.text ?? null,
    outcome: fields.outcome ?? null,
    error: fields.error ?? null,
  };
}

function refuse(requestId: string, error: ControlReplyError): ControlReplyPayload {
  return answer(requestId, { ok: false, error });
}

export function createControlCommandHandler(options: {
  readonly tabs: ControlTabs;
  readonly reply: (reply: ControlReplyPayload) => void;
}): ControlCommandHandler {
  const { tabs } = options;
  /** The tail of each pane's send queue; it never rejects, so a failed send cannot jam the next. */
  const sendQueues = new Map<number, Promise<void>>();

  function enqueueSend<T>(paneId: number, job: () => Promise<T>): Promise<T> {
    const previous = sendQueues.get(paneId) ?? Promise.resolve();
    const ran = previous.then(job);
    const tail = ran.then(
      () => undefined,
      () => undefined,
    );
    sendQueues.set(paneId, tail);
    void tail.then(() => {
      if (sendQueues.get(paneId) === tail) sendQueues.delete(paneId);
    });
    return ran;
  }

  async function open(command: ControlCommandPayload): Promise<ControlReplyPayload> {
    if (command.cwd === null || command.agent === null) {
      return refuse(command.requestId, "invalid");
    }
    const opened = await tabs.openAgentTab({
      cwd: command.cwd,
      agent: command.agent,
      name: command.name,
    });
    return opened.ok
      ? answer(command.requestId, { ok: true, paneId: opened.paneId })
      : refuse(command.requestId, opened.error);
  }

  async function send(command: ControlCommandPayload): Promise<ControlReplyPayload> {
    // Controls and escape sequences never reach the pane; newlines stay, a brief has several lines.
    const text = sanitizeTerminalPaste(stripAnsiSequences(command.text ?? ""));
    if (text.trim() === "") {
      return refuse(command.requestId, "empty-text");
    }
    const { expectedAgent, paneId } = command;
    if (expectedAgent === null) {
      return refuse(command.requestId, "not-an-agent-pane");
    }
    return enqueueSend(paneId, async () => {
      // ORC23: look at the pane right before typing. A pane that is not running the agent main
      // gated on gets nothing, and the process id read here is the one Enter must find again.
      const running = await tabs.agentProcessOf(paneId);
      if (running === null) {
        return refuse(command.requestId, "no-target");
      }
      if (running.agent !== expectedAgent || running.processId === null) {
        return refuse(command.requestId, "not-an-agent-pane");
      }
      // Main answered this call with a timeout once `deadline` passed, and a coordinator that got
      // one retries. Typing now would put the text in twice, so a send that waited in the queue
      // past it is dropped; the same bound withholds Enter if it passes during the pause.
      if (command.deadline !== null && Date.now() > command.deadline) {
        return refuse(command.requestId, "expired");
      }
      const outcome = await tabs.injectIntoPane(paneId, text, {
        autoSend: command.submit === true,
        expectedAgent,
        submitDelayMs: CONTROL_SUBMIT_DELAY_MS,
        expectedProcessId: running.processId,
        ...(command.deadline === null ? {} : { submitDeadline: command.deadline }),
      });
      return answer(command.requestId, {
        ok: outcome === "sent" || outcome === "pasted",
        outcome,
      });
    });
  }

  function read(command: ControlCommandPayload): ControlReplyPayload {
    const lines = Math.min(
      Math.max(command.lines ?? CONTROL_READ_DEFAULT_LINES, 1),
      CONTROL_READ_MAX_LINES,
    );
    const raw = tabs.serializePane(command.paneId, lines);
    if (raw === null) {
      return refuse(command.requestId, "no-target");
    }
    return answer(command.requestId, { ok: true, text: lastRows(stripAnsiSequences(raw), lines) });
  }

  async function close(command: ControlCommandPayload): Promise<ControlReplyPayload> {
    const outcome = await tabs.closePaneById(command.paneId, { force: command.force === true });
    if (outcome === "closed") {
      return answer(command.requestId, { ok: true });
    }
    return refuse(command.requestId, outcome === "declined" ? "not-closed" : "no-target");
  }

  async function run(command: ControlCommandPayload): Promise<ControlReplyPayload> {
    switch (command.command) {
      case "open":
        return open(command);
      case "send":
        return send(command);
      case "read":
        return read(command);
      case "close":
        return close(command);
    }
  }

  return {
    async handle(payload) {
      const command = parseControlCommand(payload);
      if (command === null) {
        // Without a request id there is nobody to answer; main's own timeout settles the call.
        console.warn("control:command ignored: the payload is not a control command");
        return;
      }
      let reply: ControlReplyPayload;
      try {
        reply = await run(command);
      } catch (error) {
        console.warn(`control:command ${command.command} failed:`, error);
        reply = refuse(command.requestId, "renderer-error");
      }
      options.reply(reply);
    },
  };
}
