import type { TreePane } from "@protocol/tree";
import { screenAsksQuestion } from "@/choices/parse-choices";

/** How long a new agent gets to read idle before its prompt is held (the desktop caps its own wait at the same 60 s). */
export const READY_TIMEOUT_MS = 60_000;
/** Screen rows read before deciding. */
export const GUARD_READ_LINES = 40;

export type HeldReason = "question" | "timeout" | "send-failed";

/**
 * The guarded first prompt (spec MOB20, orchestration "safe order"): open the agent with NO prompt,
 * wait until it is idle, read its screen, and type the prompt only if nothing is being asked. A
 * first-run trust dialog reads as idle, so idle alone is not enough.
 */
export type GuardState =
  | { readonly phase: "waiting" }
  | { readonly phase: "reading" }
  | { readonly phase: "sending" }
  | { readonly phase: "sent"; readonly outcome: string }
  | { readonly phase: "held"; readonly reason: HeldReason; readonly message: string | null }
  | { readonly phase: "failed"; readonly message: string };

export type GuardEvent =
  | { readonly t: "tree"; readonly pane: TreePane | null }
  | { readonly t: "screen"; readonly text: string }
  | { readonly t: "screen-failed" }
  | { readonly t: "sent"; readonly outcome: string }
  | { readonly t: "send-failed"; readonly message: string }
  | { readonly t: "timeout" };

export const GUARD_START: GuardState = { phase: "waiting" };

export function guardReduce(state: GuardState, event: GuardEvent): GuardState {
  switch (event.t) {
    case "tree": {
      if (state.phase !== "waiting" && state.phase !== "reading") return state;
      if (event.pane === null) return state; // not in the tree yet
      if (event.pane.phase === "exited") {
        return { phase: "failed", message: "The agent exited before it was ready." };
      }
      if (state.phase === "waiting" && event.pane.agent !== null && event.pane.phase === "idle") {
        return { phase: "reading" };
      }
      return state;
    }
    case "screen":
      if (state.phase !== "reading") return state;
      return screenAsksQuestion(event.text)
        ? { phase: "held", reason: "question", message: null }
        : { phase: "sending" };
    case "screen-failed":
      // Not knowing what the screen says is not a licence to type into it.
      return state.phase === "reading"
        ? { phase: "held", reason: "question", message: null }
        : state;
    case "sent":
      return state.phase === "sending" ? { phase: "sent", outcome: event.outcome } : state;
    case "send-failed":
      return state.phase === "sending"
        ? { phase: "held", reason: "send-failed", message: event.message }
        : state;
    case "timeout":
      return state.phase === "waiting" || state.phase === "reading"
        ? { phase: "held", reason: "timeout", message: null }
        : state;
  }
}

/** What the pane screen tells the user for each outcome; null while nothing needs saying. */
export function guardBanner(state: GuardState, agentName: string): string | null {
  switch (state.phase) {
    case "waiting":
    case "reading":
      return `Waiting for ${agentName} to be ready. Your prompt is sent when it is.`;
    case "sending":
      return `Sending your prompt to ${agentName}…`;
    case "sent":
      return null;
    case "failed":
      return state.message;
    case "held":
      if (state.reason === "question") {
        return `${agentName} asked something first. Answer it, then send your prompt.`;
      }
      if (state.reason === "timeout") {
        return `${agentName} did not get ready in time. Your prompt is in the box below; send it when the agent is ready.`;
      }
      return `${state.message ?? "The prompt could not be sent."} Your prompt is in the box below.`;
  }
}

/** Prompts waiting for their pane to exist on screen: set by the New agent sheet, taken once by the pane screen. */
const pending = new Map<string, string>();
const keyOf = (desktopId: string, paneId: number): string => `${desktopId}:${paneId}`;
export function setPendingPrompt(desktopId: string, paneId: number, prompt: string): void {
  pending.set(keyOf(desktopId, paneId), prompt);
}
export function takePendingPrompt(desktopId: string, paneId: number): string | null {
  const key = keyOf(desktopId, paneId);
  const prompt = pending.get(key) ?? null;
  pending.delete(key);
  return prompt;
}
