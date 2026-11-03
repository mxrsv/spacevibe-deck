/**
 * The request table behind the commands that need the renderer (spec
 * 2026-11-03-agent-orchestration, ORC11-13, ORC16).
 *
 * `forward` pushes one `control:command` to the window that owns a pane and holds the HTTP call
 * until that window answers with `control_reply`, or a timeout, or the caller hanging up ends it.
 * A reply counts only when it names a request this table is still holding and comes from the
 * window the request was pushed to, so one window can neither answer for another nor invent an
 * answer. Pure: delivery and the owner lookup are injected, and the clock is `setTimeout`, so
 * every branch is tested with fake timers.
 *
 * One case outlives the call. `open` creates a tab, and a tab nobody can control is an orphan, so
 * a reply that arrives after its call timed out or hung up is still handed to `onLate` for a
 * while, which lets the router record who opened the new pane.
 */
import { randomUUID } from "node:crypto";
import type { ControlCommandPayload, ControlReplyPayload } from "../../src/lib/control-command";
import { EVENTS } from "../ipc/channels";

/** How long a timed-out or hung-up `open` can still be answered, so its pane is not orphaned. */
export const LATE_REPLY_MS = 120_000;

/** Every key of a command except the request id, which the table mints. */
export type ControlCommandFields = Omit<ControlCommandPayload, "requestId">;

/** A command with every key present: the keys a command does not use are null (R6). */
export function commandFields(
  command: ControlCommandFields["command"],
  paneId: number,
  used: Partial<Omit<ControlCommandFields, "command" | "paneId">> = {},
): ControlCommandFields {
  return {
    command,
    paneId,
    cwd: null,
    agent: null,
    name: null,
    text: null,
    submit: null,
    expectedAgent: null,
    lines: null,
    force: null,
    ...used,
  };
}

export type ForwardResult =
  | { readonly ok: true; readonly reply: ControlReplyPayload }
  | { readonly ok: false; readonly error: "renderer-timeout" | "window-gone" | "aborted" };

export interface ForwardRequest {
  /** The pane whose HTTP call is waiting; the entry dies with it. */
  readonly callerPaneId: number;
  readonly fields: ControlCommandFields;
  readonly timeoutMs: number;
  /** Aborts when the caller hangs up; nothing is pushed after that. */
  readonly signal?: AbortSignal;
  /** Receives a reply that came after the call gave up, within `LATE_REPLY_MS`. */
  readonly onLate?: (reply: ControlReplyPayload) => void;
}

export interface ControlForwarderDeps {
  readonly deliver: (paneId: number, event: string, payload: unknown) => void;
  /** The label of the window that owns the pane, or null while it is being transferred. */
  readonly windowOf: (paneId: number) => string | null;
  readonly log: (message: string) => void;
  readonly newRequestId?: () => string;
}

export interface ControlForwarder {
  forward(request: ForwardRequest): Promise<ForwardResult>;
  /**
   * Resolve the request a reply names. False, and nothing else happens, when the request is
   * unknown or expired, or `fromWindow` is not the window it was pushed to.
   */
  settle(fromWindow: string, reply: ControlReplyPayload): boolean;
  /** Drop every request of a caller whose pane is gone. */
  forgetCaller(paneId: number): void;
}

interface Entry {
  readonly callerPaneId: number;
  readonly window: string;
  readonly onLate: ((reply: ControlReplyPayload) => void) | undefined;
  /** Set once the call has given up; a reply is then `onLate`'s, not a result. */
  gaveUp: boolean;
  finish: (result: ForwardResult) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createControlForwarder(deps: ControlForwarderDeps): ControlForwarder {
  const entries = new Map<string, Entry>();
  const newRequestId = deps.newRequestId ?? randomUUID;

  function drop(requestId: string): void {
    const entry = entries.get(requestId);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    entries.delete(requestId);
  }

  return {
    forward({ callerPaneId, fields, timeoutMs, signal, onLate }) {
      if (signal?.aborted === true) {
        return Promise.resolve({ ok: false, error: "aborted" });
      }
      const window = deps.windowOf(fields.paneId);
      if (window === null) {
        return Promise.resolve({ ok: false, error: "window-gone" });
      }
      const requestId = newRequestId();
      return new Promise<ForwardResult>((resolve) => {
        let settled = false;
        const entry: Entry = {
          callerPaneId,
          window,
          onLate,
          gaveUp: false,
          timer: undefined,
          finish(result) {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            resolve(result);
          },
        };
        /** The call is over; an `open` stays answerable for its late reply, anything else is dropped. */
        function giveUp(error: "renderer-timeout" | "aborted"): void {
          entry.finish({ ok: false, error });
          if (onLate === undefined) {
            drop(requestId);
            return;
          }
          entry.gaveUp = true;
          clearTimeout(entry.timer);
          entry.timer = setTimeout(() => drop(requestId), LATE_REPLY_MS);
          entry.timer.unref?.();
        }
        function onAbort(): void {
          giveUp("aborted");
        }
        entry.timer = setTimeout(() => giveUp("renderer-timeout"), timeoutMs);
        entry.timer.unref?.();
        entries.set(requestId, entry);
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          deps.deliver(fields.paneId, EVENTS.controlCommand, { requestId, ...fields });
        } catch (error) {
          deps.log(`Deck: a control command could not be delivered to ${window}: ${String(error)}`);
          drop(requestId);
          entry.finish({ ok: false, error: "window-gone" });
        }
      });
    },
    settle(fromWindow, reply) {
      const entry = entries.get(reply.requestId);
      if (entry === undefined) {
        deps.log("Deck: refused a control reply for a request that is unknown or expired");
        return false;
      }
      if (entry.window !== fromWindow) {
        deps.log(`Deck: refused a control reply from ${fromWindow}, which was not asked`);
        return false;
      }
      drop(reply.requestId);
      if (entry.gaveUp) {
        entry.onLate?.(reply);
        return true;
      }
      entry.finish({ ok: true, reply });
      return true;
    },
    forgetCaller(paneId) {
      for (const [requestId, entry] of [...entries]) {
        if (entry.callerPaneId !== paneId) continue;
        drop(requestId);
        // A held call of a pane that is gone has nobody left to read the answer.
        entry.finish({ ok: false, error: "window-gone" });
      }
    },
  };
}
