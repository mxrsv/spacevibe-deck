/**
 * Renderer facade for the in-pane `deck` command's phase mirror (spec
 * 2026-11-03-agent-orchestration, ORC17): the `pane_attention_report` channel.
 *
 * Fire-and-forget and never throws into the UI loop. It is called from the tab manager's
 * view sync, which runs on every output chunk that changes anything, so an absent host (the
 * browser-only preview, a test with no bridge) is swallowed after one warning instead of one
 * per call, and a rejected report (main refused the pane, a validation error) is logged and
 * dropped: the next change reports again.
 *
 * Electron-only like `worktree-host.ts`: no Tauri counterpart exists.
 */
import { invoke } from "./bridge";
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
