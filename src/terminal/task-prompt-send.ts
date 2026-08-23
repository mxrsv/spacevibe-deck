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
   * Pasted but not submitted — the gate closed between the paste and the `\r`.
   * TERMINAL: the text is already in the agent's composer, so retrying would
   * duplicate it. This is how "exactly once" survives the failure path.
   */
  | "prompt-pending"
  /** Readiness never arrived within the timeout; nothing was pasted. */
  | "prompt-not-sent"
  /** The paste itself failed. */
  | "prompt-failed"
  /** The tab never materialized. */
  | "spawn-failed";

/** Whether an outcome may clear the draft and close the launcher. */
export function launchSucceeded(outcome: LaunchTaskOutcome): boolean {
  return outcome === "started" || outcome === "sent";
}
