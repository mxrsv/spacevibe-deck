import {
  agentOptions,
  BUILTIN_AGENTS,
  type BuiltinAgent,
  type CustomAgent,
} from "../../lib/agent-catalog";
import { agentLaunchCommand } from "../../lib/launch-command";
import { agentChanged } from "../../settings/settings-rows";
import type { Settings } from "../../settings/settings-schema";
import { agentHooksSupported } from "../../settings/agent-hooks-support-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { ADAPTER_AGENTS, HOOK_ONLY_ADAPTER_AGENTS } from "../settings/launch-profile-editor";

/** Everything an agent row prints and edits, read from one settings snapshot and the detection state. */
export interface AgentRowData {
  readonly id: string;
  readonly label: string;
  /** Null for a declared agent: only a built-in has launch flags and model defaults. */
  readonly builtin: BuiltinAgent | null;
  readonly custom: CustomAgent | null;
  /** The command a new session types. */
  readonly command: string;
  readonly installed: boolean;
  /** Detection has answered; before that every agent would read as missing. */
  readonly probed: boolean;
  readonly enabled: boolean;
  /** This agent's Signals switch; null where no adapter exists for it. */
  readonly signals: boolean | null;
  /** False where the host cannot run this agent's adapter (hook-only adapters off macOS). */
  readonly signalsAvailable: boolean;
  readonly changed: boolean;
}

/** Whether detection found this agent's binary; reads `detectedAgents`, so call it while rendering. */
export function agentInstalled(agentId: string, settings: Settings): boolean {
  const option = agentOptions(detectedAgents.value, settings.customAgents).find(
    (entry) => entry.id === agentId,
  );
  return option !== undefined && !option.missing;
}

/** Reads `detectedAgents`, `agentsProbed` and `agentHooksSupported`, so call it while rendering. */
export function agentRowData(agentId: string, settings: Settings): AgentRowData {
  const builtin = BUILTIN_AGENTS.find((agent) => agent.id === agentId) ?? null;
  const custom = settings.customAgents.find((agent) => agent.id === agentId) ?? null;
  const adapters = settings.agentSignalAdapters;
  return {
    id: agentId,
    label: builtin?.label ?? custom?.label ?? agentId,
    builtin,
    custom,
    command:
      agentLaunchCommand(
        agentId,
        settings.launchProfiles,
        settings.defaultLaunchProfiles,
        settings.customAgents,
      ) ?? agentId,
    installed: agentInstalled(agentId, settings),
    probed: agentsProbed.value,
    enabled: !settings.disabledAgents.includes(agentId),
    signals: ADAPTER_AGENTS.has(agentId) ? adapters[agentId as keyof typeof adapters] : null,
    signalsAvailable: agentHooksSupported.value || !HOOK_ONLY_ADAPTER_AGENTS.has(agentId),
    changed: agentChanged(agentId, settings),
  };
}
