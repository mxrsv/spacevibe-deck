/**
 * Whether this host registers agent hooks, asked of the host once per window
 * (R5) and only when Settings needs it.
 *
 * The answer decides one thing: whether Claude's Signals switch is live (the
 * adapters that work only through a hook script; see `launch-profile-editor.tsx`).
 * Windows ships no hook script, so there it says so instead of offering a
 * control that does nothing. It is `true` until the host says
 * otherwise, so macOS, Tauri and a failed call render the switch exactly as
 * they always did.
 */
import { signal } from "@preact/signals";
import { agentSignalConfig, NO_SIGNAL_CONFIG } from "../host/agent-signals-host";

export const agentHooksSupported = signal(true);

/** True once the host has actually answered; a no-host or failed call has not. */
let answered = false;
let inFlight: Promise<void> | null = null;

async function load(): Promise<void> {
  const config = await agentSignalConfig();
  agentHooksSupported.value = config.hooksSupported;
  // The facade returns its frozen default for "no host" and for a failed call.
  // That is not an answer, so the next Settings mount may ask again; a real
  // answer is kept for the window's life.
  answered = config !== NO_SIGNAL_CONFIG;
}

/**
 * Ask once per window. Concurrent callers share the one request, and a host
 * that has answered is never asked again.
 */
export function ensureAgentHooksSupportLoaded(): Promise<void> {
  if (answered) {
    return Promise.resolve();
  }
  inFlight ??= load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Test seam. The app never calls this; the suite clears module state. */
export function resetAgentHooksSupportForTests(): void {
  answered = false;
  inFlight = null;
  agentHooksSupported.value = true;
}
