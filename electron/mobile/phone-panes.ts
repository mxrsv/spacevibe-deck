/**
 * What a phone may do to a pane: read it, type into it, open an agent. Scope is every pane in
 * every window (spec decision 22), so none of this goes through `createPaneCommands`, which is the
 * in-pane CLI's caller-scoped layer. It rides the layer below, a SECOND `ControlForwarder`, and the
 * renderer's existing `control:command` handler, so the paste, the Enter gate and the agent-process
 * check are exactly the CLI's.
 *
 * Main never types into a PTY. `send` on an agent pane is the guarded control `send`; on a shell
 * pane, and for raw keystrokes, the text goes to the owning window as `mobile:input`, which writes
 * it through the pane's own `writePty` so input counts as input (echo suppression).
 *
 * `open` is callerless (F4): it names a project and checkout, not a caller pane. The window is the
 * one that holds the project, else the focused one, else the main one; nothing is focused or
 * moved. A prompt is delivered by the orchestration spec's guarded flow: wait for the new agent to
 * read idle for the first time, then control `send` with that agent as `expectedAgent`.
 */
import { stat } from "node:fs/promises";
import { CONTROL_SEND_OUTCOMES, type ControlReplyPayload } from "../../src/lib/control-command";
import { stripAnsiSequences } from "../../src/lib/strip-ansi-sequences";
import { sanitizeTerminalPaste } from "../../src/lib/terminal-paste";
import {
  commandFields,
  type ControlForwarder,
  type ForwardResult,
} from "../control/control-forward";
import type { PaneMirror } from "../control/pane-mirror";
import { PhoneError } from "./phone-error";

/** Not a pane: the `callerPaneId` every phone request is filed under. */
export const PHONE_CALLER = 0;
export const READ_TIMEOUT_MS = 15_000;
export const SEND_TIMEOUT_MS = 15_000;
export const OPEN_TIMEOUT_MS = 30_000;
/** How long a new agent gets to read idle before its prompt is given up on. */
export const FIRST_IDLE_CAP_MS = 60_000;

export interface PhonePanesDeps {
  readonly forwarder: ControlForwarder;
  /** Forward an `open` to a named window; there is no caller pane to route by. */
  readonly forwardOpen: (
    label: string,
    fields: ReturnType<typeof commandFields>,
    timeoutMs: number,
  ) => Promise<ForwardResult>;
  readonly mirror: PaneMirror;
  readonly windowOf: (paneId: number) => string | null;
  /** Hands keystrokes to the owning window's `paneIo.writePty`; false when the pane has no window. */
  readonly sendInput: (paneId: number, data: string) => boolean;
  readonly tree: {
    windowHolding(path: string): string | null;
    isKnownRoot(root: string): Promise<boolean>;
  };
  readonly focusedWindow: () => string | null;
  readonly mainWindow: () => string | null;
  readonly isDirectory?: (target: string) => Promise<boolean>;
  readonly log: (message: string) => void;
}

export interface OpenParams {
  readonly projectPath: string;
  readonly checkoutPath: string;
  readonly agent: string;
  readonly prompt: string | null;
}

function cleanText(text: string): string {
  return sanitizeTerminalPaste(stripAnsiSequences(text));
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function forwardFailure(error: Extract<ForwardResult, { ok: false }>["error"]): PhoneError {
  return error === "renderer-timeout"
    ? new PhoneError("unavailable", "Deck did not answer in time")
    : new PhoneError("no-target", "That pane is gone");
}

/** The renderer's refusal as the protocol's closed set. */
function replyFailure(reply: ControlReplyPayload): PhoneError {
  switch (reply.outcome ?? reply.error) {
    case "busy":
      return new PhoneError("busy", "That pane is taking another paste");
    case "no-target":
      return new PhoneError("no-target", "That pane is gone");
    case "expired":
      return new PhoneError("expired", "The send waited too long and was dropped");
    case "not-an-agent-pane":
    case "stale":
      return new PhoneError("not-an-agent-pane", "The agent in that pane changed");
    case "empty-text":
      return new PhoneError("invalid", "The text is empty");
    case "unknown-agent":
      return new PhoneError("not-found", "That agent is not enabled or not installed");
    case "spawn-failed":
      return new PhoneError("unavailable", "The tab could not be opened");
    default:
      return new PhoneError("internal", "The Deck window could not do that");
  }
}

export interface PhonePanes {
  read(paneId: number, lines: number): Promise<string>;
  send(paneId: number, text: string, submit: boolean): Promise<{ outcome: string }>;
  input(paneId: number, data: string): void;
  open(params: OpenParams): Promise<{ paneId: number }>;
}

export function createPhonePanes(deps: PhonePanesDeps): PhonePanes {
  const isDirectory = deps.isDirectory ?? directoryExists;

  function requirePane(paneId: number): string {
    const label = deps.windowOf(paneId);
    if (label === null) throw new PhoneError("no-target", "That pane is gone");
    return label;
  }

  async function sendToAgent(
    paneId: number,
    agent: string,
    text: string,
    submit: boolean,
  ): Promise<string> {
    const result = await deps.forwarder.forward({
      callerPaneId: PHONE_CALLER,
      fields: commandFields("send", paneId, { text, submit, expectedAgent: agent }),
      timeoutMs: SEND_TIMEOUT_MS,
    });
    if (!result.ok) throw forwardFailure(result.error);
    const outcome = CONTROL_SEND_OUTCOMES.find((candidate) => candidate === result.reply.outcome);
    if (result.reply.ok && (outcome === "sent" || outcome === "pasted")) return outcome;
    throw replyFailure(result.reply);
  }

  /** The prompt of a new pane: only after the agent first reads idle (ORC11). */
  async function deliverFirstPrompt(paneId: number, prompt: string): Promise<void> {
    const idle = await deps.mirror.wait(paneId, "idle", { capMs: FIRST_IDLE_CAP_MS });
    if (!idle.reached || idle.state.phase !== "idle" || idle.state.agent === null) {
      deps.log(`Deck: the first prompt for pane ${paneId} was not sent, the agent never read idle`);
      return;
    }
    try {
      await sendToAgent(paneId, idle.state.agent, prompt, true);
    } catch (error) {
      deps.log(`Deck: the first prompt for pane ${paneId} failed: ${String(error)}`);
    }
  }

  return {
    async read(paneId, lines) {
      requirePane(paneId);
      const result = await deps.forwarder.forward({
        callerPaneId: PHONE_CALLER,
        fields: commandFields("read", paneId, { lines }),
        timeoutMs: READ_TIMEOUT_MS,
      });
      if (!result.ok) throw forwardFailure(result.error);
      if (!result.reply.ok || result.reply.text === null) throw replyFailure(result.reply);
      return cleanText(result.reply.text);
    },

    async send(paneId, rawText, submit) {
      requirePane(paneId);
      const text = cleanText(rawText);
      const agent = deps.mirror.get(paneId)?.agent ?? null;
      if (agent !== null && text.trim() !== "") {
        return { outcome: await sendToAgent(paneId, agent, text, submit) };
      }
      if (agent !== null && !submit) throw new PhoneError("invalid", "The text is empty");
      // A shell pane, or just Enter for an agent: the keystrokes go through the input path.
      const keys = text.replace(/\n/g, "\r") + (submit ? "\r" : "");
      if (keys === "") throw new PhoneError("invalid", "The text is empty");
      if (!deps.sendInput(paneId, keys)) throw new PhoneError("no-target", "That pane is gone");
      return { outcome: "sent" };
    },

    input(paneId, data) {
      requirePane(paneId);
      if (!deps.sendInput(paneId, data)) throw new PhoneError("no-target", "That pane is gone");
    },

    async open(params) {
      if (!(await deps.tree.isKnownRoot(params.checkoutPath))) {
        throw new PhoneError("outside-root", "That folder is not one of Deck's projects");
      }
      if (!(await isDirectory(params.checkoutPath))) {
        throw new PhoneError("not-found", "That folder no longer exists");
      }
      const label =
        deps.tree.windowHolding(params.checkoutPath) ??
        deps.tree.windowHolding(params.projectPath) ??
        deps.focusedWindow() ??
        deps.mainWindow();
      if (label === null) throw new PhoneError("unavailable", "Deck has no window open");
      const prompt = params.prompt === null ? null : cleanText(params.prompt);
      const result = await deps.forwardOpen(
        label,
        commandFields("open", 1, { cwd: params.checkoutPath, agent: params.agent, name: null }),
        OPEN_TIMEOUT_MS,
      );
      if (!result.ok) throw forwardFailure(result.error);
      const { reply } = result;
      if (!reply.ok || reply.paneId === null) throw replyFailure(reply);
      if (prompt !== null && prompt.trim() !== "") {
        // The pane exists; the phone gets its id now and the prompt follows when the agent is ready.
        void deliverFirstPrompt(reply.paneId, prompt);
      }
      return { paneId: reply.paneId };
    },
  };
}
