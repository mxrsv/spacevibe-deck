/**
 * Renderer facade for the in-pane `deck` command (spec 2026-11-03-agent-orchestration): the
 * `pane_attention_report` channel of the phase mirror (ORC17), and the `control:command` push
 * with its `control_reply` answer (ORC11-13, ORC16).
 *
 * Fire-and-forget and never throws into the UI loop. It is called from the tab manager's
 * view sync, which runs on every output chunk that changes anything, so an absent host (the
 * browser-only preview, a test with no bridge) is swallowed after one warning instead of one
 * per call, and a rejected report (main refused the pane, a validation error) is logged and
 * dropped: the next change reports again.
 *
 * Electron-only like `worktree-host.ts`: no Tauri counterpart exists.
 */
import { invoke, listen, type UnlistenFn } from "./bridge";
import type { ControlReplyPayload } from "../lib/control-command";
import type { PaneAttentionReport } from "../lib/pane-attention-report";

function hostPresent(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __deckHost?: unknown }).__deckHost !== undefined
  );
}

let warnedAbsent = false;

/**
 * Flat payload per R6 — the object literal (not an identifier) is what
 * `scripts/electron-ipc-contract.test.ts` can see the keys of.
 */
export function reportPaneAttention({
  paneId,
  phase,
  attention,
  source,
  confidence,
  agent,
  pid,
}: PaneAttentionReport): void {
  if (!hostPresent()) {
    if (!warnedAbsent) {
      warnedAbsent = true;
      console.warn("pane_attention_report skipped: the Deck host bridge is unavailable");
    }
    return;
  }
  try {
    invoke<boolean>("pane_attention_report", {
      paneId,
      phase,
      attention,
      source,
      confidence,
      agent,
      pid,
    }).catch((error: unknown) => {
      console.warn("pane_attention_report failed:", error);
    });
  } catch (error) {
    console.warn("pane_attention_report failed:", error);
  }
}

/**
 * Hear the commands main pushes for the panes this window owns. The payload is handed over
 * unchecked: the handler parses it, because a shape main does not send is the handler's to
 * refuse. Where the bridge is absent there is nothing to hear.
 */
export async function listenControlCommands(
  handler: (payload: unknown) => void,
): Promise<UnlistenFn> {
  if (!hostPresent()) {
    return () => {};
  }
  return listen<unknown>("control:command", ({ payload }) => handler(payload));
}

let warnedReplyAbsent = false;

/**
 * Answer one command. Flat payload per R6, every key present — the object literal is what the
 * contract test can see the keys of. Main answers false for a request that already timed out or
 * was addressed to another window; that is logged, because the caller has long since moved on.
 */
export function replyControl({
  requestId,
  ok,
  paneId,
  text,
  outcome,
  error,
}: ControlReplyPayload): void {
  if (!hostPresent()) {
    if (!warnedReplyAbsent) {
      warnedReplyAbsent = true;
      console.warn("control_reply skipped: the Deck host bridge is unavailable");
    }
    return;
  }
  try {
    invoke<boolean>("control_reply", {
      requestId,
      ok,
      paneId,
      text,
      outcome,
      error,
    })
      .then((settled) => {
        if (!settled) console.warn("control_reply was not accepted: the request had expired");
      })
      .catch((failure: unknown) => {
        console.warn("control_reply failed:", failure);
      });
  } catch (failure) {
    console.warn("control_reply failed:", failure);
  }
}
