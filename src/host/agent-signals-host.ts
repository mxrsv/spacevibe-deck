/**
 * Renderer facade for the agent-signal contract layer's stage-2 channels:
 * the launch config (`agent_signal_config`), opencode's per-pane attachment
 * (`opencode_attach`) and the `hook:event` push. Electron-only, like
 * `agent-registry-host.ts`: `available` is the same host-presence check, and
 * every function degrades to "no adapter" where the host cannot answer, so a
 * Tauri or browser-preview launch is typed exactly as before.
 *
 * Flat payload keys per R6 — the object literal is what
 * `scripts/electron-ipc-contract.test.ts` reads.
 */
import { invoke, listen, type UnlistenFn } from "./bridge";
import { parseHookEvent, type HookEvent } from "../lib/agent-signal-map";

export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export interface AgentSignalConfig {
  readonly claudeSettingsPath: string | null;
  readonly hookPort: number | null;
}

export const NO_SIGNAL_CONFIG: AgentSignalConfig = Object.freeze({
  claudeSettingsPath: null,
  hookPort: null,
});

/** Never rejects: a host that cannot answer has no adapters. */
export async function agentSignalConfig(): Promise<AgentSignalConfig> {
  if (!available) {
    return NO_SIGNAL_CONFIG;
  }
  try {
    const raw = await invoke<unknown>("agent_signal_config");
    if (typeof raw !== "object" || raw === null) {
      return NO_SIGNAL_CONFIG;
    }
    const node = raw as Record<string, unknown>;
    return {
      claudeSettingsPath:
        typeof node.claudeSettingsPath === "string" && node.claudeSettingsPath !== ""
          ? node.claudeSettingsPath
          : null,
      hookPort:
        typeof node.hookPort === "number" &&
        Number.isSafeInteger(node.hookPort) &&
        node.hookPort > 0
          ? node.hookPort
          : null,
    };
  } catch (error) {
    console.warn("agent_signal_config failed:", error);
    return NO_SIGNAL_CONFIG;
  }
}

/** Reserve a port for an opencode pane and subscribe main to it; null when the host cannot. */
export async function opencodeAttach(paneId: number): Promise<number | null> {
  if (!available) {
    return null;
  }
  try {
    const raw = await invoke<unknown>("opencode_attach", { paneId });
    const port = (raw as { port?: unknown } | null)?.port;
    return typeof port === "number" && Number.isSafeInteger(port) && port > 0 ? port : null;
  } catch (error) {
    console.warn("opencode_attach failed:", error);
    return null;
  }
}

/** Subscribe to accepted hook posts and server events for this window's panes. */
export async function listenHookEvents(handler: (event: HookEvent) => void): Promise<UnlistenFn> {
  if (!available) {
    return () => {};
  }
  return listen<unknown>("hook:event", ({ payload }) => {
    const event = parseHookEvent(payload);
    if (event !== null) {
      handler(event);
    }
  });
}
