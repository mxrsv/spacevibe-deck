/**
 * When a freshly launched agent is ready to be handed its first prompt.
 *
 * **This is not the gate `AgentLauncher` already has.** That one is SHELL
 * readiness — OSC 133;B, the interactive shell printing a prompt — and it fires
 * *before* the agent binary has even been typed, let alone booted. Spec §8's
 * step 6 and step 8 are two different gates and only the first one existed.
 *
 * The second one is the Prompt Board's, unchanged: `submitAllowed` in
 * `../prompts/inject.ts` already answers "is this pane running the agent I
 * expect, idle, with nothing latched, still in a layout" per pane, and it is
 * the same question asked at a different moment.
 *
 * **Why the moment matters.** `injectIntoPane` pastes UNCONDITIONALLY and gates
 * only the trailing `\r`. Calling it while the pane is still a bare shell would
 * paste the task prompt into that shell — which spec §8 forbids in as many
 * words ("It must not type the prompt into a plain shell as a fallback"). So a
 * launch polls THIS predicate first and calls `injectIntoPane` only once it
 * passes; the inject's own gate is then the second check, not the first.
 *
 * It is its own exported name rather than a direct `submitAllowed` call at the
 * call site so that a future divergence between "may I paste at all" and "may I
 * press Enter" cannot silently change the Prompt Board's behaviour.
 */

import { submitAllowed, type SubmitGateInput } from "../prompts/inject";

/**
 * How long a launch waits for its agent before giving up on the prompt.
 *
 * A fresh agent that emits no OSC 9;4 and little output can legitimately sit at
 * `phase: "unknown"` — `agent-activity.ts` says so directly — so the wait needs
 * a ceiling or a quiet agent would hold a pending launch open forever. On
 * timeout the tab stays; only the prompt is not sent.
 */
export const TASK_PROMPT_READY_TIMEOUT_MS = 90_000;

/** Cheap enough to feel immediate, slow enough not to spam `pty_info`. */
export const TASK_PROMPT_POLL_MS = 500;

/**
 * Whether a launched task's prompt is SUBMITTED for the user, or only placed in
 * the agent's composer for them to send.
 *
 * **False, and measured.** On 2026-08-24 a real `node-pty` probe ran
 * `claude --dangerously-skip-permissions` in a directory it had never seen and
 * fed the output through Deck's own `createAgentActivity`. The agent printed
 *
 * ```
 * Quick safety check: Is this a project you created or one you trust?
 * ❯ 1. Yes, I trust this folder
 *   2. No, exit
 * Enter to confirm · Esc to cancel
 * ```
 *
 * and the tracker settled at `phase: "idle"`, `attention: "none"` — no OSC 9;4,
 * no bell, nothing latched. So `promptReadyToSend` answers TRUE while that menu
 * is on screen, and an auto-send would press Enter on it: Deck would accept
 * "Yes, I trust this folder" on the user's behalf and swallow their prompt.
 * `--dangerously-skip-permissions` does not suppress the dialog, and the same
 * probe in an already-trusted folder shows none — so it lands on the FIRST open
 * of a workspace, which is exactly what this launcher is for.
 *
 * Nothing in the signals Deck has distinguishes that menu from a ready prompt,
 * so the gate cannot be tightened into correctness. Not pressing Enter is what
 * makes the worst case harmless: the text lands in a composer (or is ignored by
 * a menu) and the user decides.
 *
 * The real fix is delivering the prompt as the agent's positional `[PROMPT]`
 * argument — both `claude` and `codex` document one — but that needs argv at
 * spawn time, and `spawn_shell` takes only `{ cols, rows, cwd }`. Widening it
 * is a PTY-ownership fork (`AGENTS.md`), so it waits for an owner decision.
 * This constant is the seam: flipping it to true restores auto-send, the
 * `GRAB_PASTE_DISABLED` / `MIGRATION_NOTICE_ENABLED` precedent.
 */
export const TASK_PROMPT_AUTOSEND = false;

/** The gate that must open BEFORE any paste. */
export function promptReadyToSend(input: SubmitGateInput): boolean {
  return submitAllowed(input);
}

/**
 * What one `launchTask` attempt did. Every value except `started` and `sent`
 * keeps the draft, because the user has something left to do.
 */
export type LaunchTaskOutcome =
  /** Tab up, no prompt was asked for. */
  | "started"
  /** Tab up, prompt delivered and submitted. */
  | "sent"
  /**
   * The prompt is in the agent's composer but was not submitted.
   *
   * With `TASK_PROMPT_AUTOSEND` false this is the EXPECTED result of a
   * prompted launch — the user presses Enter. With it true it means the gate
   * closed between the paste and the `\r`. Either way it is TERMINAL: the text
   * is already in the composer, so retrying would duplicate it, which is how
   * "exactly once" survives the failure path.
   */
  | "prompt-pending"
  /** Readiness never arrived within the timeout; nothing was pasted. */
  | "prompt-not-sent"
  /** The paste itself failed. */
  | "prompt-failed"
  /** The tab never materialized. */
  | "spawn-failed";

/**
 * Whether an outcome may clear the draft and close the launcher.
 *
 * `prompt-pending` counts while auto-send is off, because then it IS delivery:
 * the task reached the agent and only the Enter is the user's. Reading the
 * constant here rather than at the call sites keeps one answer to "did this
 * launch work".
 */
export function launchSucceeded(outcome: LaunchTaskOutcome): boolean {
  if (outcome === "started" || outcome === "sent") {
    return true;
  }
  return !TASK_PROMPT_AUTOSEND && outcome === "prompt-pending";
}
