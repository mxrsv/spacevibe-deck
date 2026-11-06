import { MAX_SEND_CHARS } from "@protocol/limits";
import type { MethodParams } from "@protocol/messages";
import { RpcError } from "@/session/rpc";

/** The sheet's whole state: which desktop, which checkout, which agent, the optional prompt (MOB20). */
export interface NewAgentState {
  readonly desktopId: string | null;
  readonly projectPath: string | null;
  readonly checkoutPath: string | null;
  readonly agent: string | null;
  readonly prompt: string;
  readonly phase: "editing" | "starting" | "failed";
  readonly error: string | null;
}

export type NewAgentAction =
  | { readonly t: "desktop"; readonly id: string }
  | { readonly t: "checkout"; readonly projectPath: string; readonly checkoutPath: string }
  | { readonly t: "agent"; readonly id: string }
  | { readonly t: "prompt"; readonly text: string }
  | { readonly t: "start" }
  | { readonly t: "failed"; readonly message: string };

export type NewAgentStep = "desktop" | "checkout" | "agent" | "ready";

/**
 * With one online desktop (or a preset one that is online) the desktop step is skipped. A preset
 * that is offline is ignored: it cannot be started on.
 */
export function initialNewAgent(
  onlineIds: readonly string[],
  preset: string | null,
): NewAgentState {
  const chosen =
    preset !== null && onlineIds.includes(preset)
      ? preset
      : onlineIds.length === 1
        ? onlineIds[0]
        : null;
  return {
    desktopId: chosen,
    projectPath: null,
    checkoutPath: null,
    agent: null,
    prompt: "",
    phase: "editing",
    error: null,
  };
}

export function reduceNewAgent(state: NewAgentState, action: NewAgentAction): NewAgentState {
  switch (action.t) {
    case "desktop":
      // Another desktop has other projects and other agents: nothing chosen so far carries over.
      return action.id === state.desktopId
        ? state
        : { ...initialNewAgent([], null), desktopId: action.id, prompt: state.prompt };
    case "checkout":
      return {
        ...state,
        projectPath: action.projectPath,
        checkoutPath: action.checkoutPath,
        phase: "editing",
        error: null,
      };
    case "agent":
      return { ...state, agent: action.id, phase: "editing", error: null };
    case "prompt":
      return { ...state, prompt: action.text.slice(0, MAX_SEND_CHARS) };
    case "start":
      return canStart(state) ? { ...state, phase: "starting", error: null } : state;
    case "failed":
      return state.phase === "starting"
        ? { ...state, phase: "failed", error: action.message }
        : state;
  }
}

export function nextStep(state: NewAgentState): NewAgentStep {
  if (state.desktopId === null) return "desktop";
  if (state.checkoutPath === null) return "checkout";
  if (state.agent === null) return "agent";
  return "ready";
}

export function canStart(state: NewAgentState): boolean {
  return nextStep(state) === "ready" && state.phase !== "starting";
}

/**
 * The `pane.open` parameters, or null while the choice is incomplete. The prompt is NEVER passed
 * here: the desktop would type it the moment the agent first reads idle, and a first-run trust
 * question reads as idle. The phone sends it itself after checking the screen (`guarded-prompt.ts`).
 */
export function openParams(state: NewAgentState): MethodParams["pane.open"] | null {
  if (state.projectPath === null || state.checkoutPath === null || state.agent === null)
    return null;
  return {
    projectPath: state.projectPath,
    checkoutPath: state.checkoutPath,
    agent: state.agent,
    prompt: null,
  };
}

/** The prompt to send once the agent is ready, or null when the box is blank. */
export function promptToSend(state: NewAgentState): string | null {
  return state.prompt.trim() === "" ? null : state.prompt;
}

/** What the sheet says when `pane.open` fails; every case names what to do. */
export function openErrorText(error: unknown): string {
  if (error instanceof RpcError) {
    switch (error.code) {
      case "outside-root":
        return "That folder is not one of Deck's projects. Open it in Deck first.";
      case "not-found":
        return "Deck could not find that folder or agent. The agent may not be enabled or installed on the desktop.";
      case "unavailable":
        return error.message === ""
          ? "Deck could not open the tab right now."
          : `${error.message}.`;
      case "timeout":
        return "Deck did not answer in time. Check that it is running, then try again.";
      case "not-connected":
      case "closed":
        return "Not connected to this desktop. Try again when it is online.";
      case "invalid":
        return "Deck could not use that prompt. Shorten or change it.";
      case "too-large":
        return "That prompt is too large to send.";
      default:
        return "Deck could not open the agent. Try again.";
    }
  }
  return "Deck could not open the agent. Try again.";
}
