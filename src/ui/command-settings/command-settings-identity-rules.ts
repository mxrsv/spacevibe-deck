import {
  agentBinary,
  AGENT_LABEL_MAX,
  BUILTIN_AGENTS,
  createCustomAgentId,
  isBuiltinAgentId,
  isProbeSafeName,
  type CustomAgent,
} from "../../lib/agent-catalog";
import { quickAgentsWithout } from "../../settings/quick-agents";
import type { Settings } from "../../settings/settings-schema";

/*
 * What a declared agent may be called and run. These are the rules of the legacy
 * `AgentIdentities` (`agents-section.tsx`), which keeps them private, so they are restated here
 * to the same words until that section is deleted at the cut-over; a change to one must be made
 * to both.
 */

/**
 * Why a declared command is rejected, or `null`. The binary is interpolated into the discovery
 * probe's shell script, so the class the host enforces is enforced here to say WHY rather than
 * let the agent silently never resolve.
 */
export function identityCommandProblem(command: string): string | null {
  const binary = agentBinary(command);
  if (binary === "") {
    return "a command is required";
  }
  if (!isProbeSafeName(binary)) {
    return "the command name may only use letters, digits and . _ - / ~ +";
  }
  return null;
}

/**
 * Why a declared name is rejected, or `null`. The label travels to the host as the identity a
 * matched process reports back, and the app reads it as an agent id: a label spelled like a
 * built-in id would hand an unrelated CLI that built-in's colour and prompts. Built-in labels
 * are refused because two rows reading "Claude Code" cannot be told apart.
 */
export function identityLabelProblem(label: string, others: readonly CustomAgent[]): string | null {
  const trimmed = label.trim();
  if (trimmed === "") {
    return "a name is required";
  }
  if (trimmed.length > AGENT_LABEL_MAX) {
    return `names stay under ${AGENT_LABEL_MAX} characters`;
  }
  if (isBuiltinAgentId(trimmed)) {
    return `"${trimmed}" is a built-in agent's id — pick another name`;
  }
  const taken =
    others.some((agent) => agent.label === trimmed) ||
    BUILTIN_AGENTS.some((agent) => agent.label === trimmed);
  return taken ? "that name is already used" : null;
}

/** The new agent list, or the reason the declaration is refused. */
export function declareAgent(
  label: string,
  command: string,
  current: readonly CustomAgent[],
): { readonly agents: readonly CustomAgent[] } | { readonly error: string } {
  const problem = identityLabelProblem(label, current) ?? identityCommandProblem(command);
  if (problem !== null) {
    return { error: problem };
  }
  return {
    agents: [
      ...current,
      { id: createCustomAgentId(label, current), label: label.trim(), command: command.trim() },
    ],
  };
}

/**
 * The patch that removes a declared agent. The caller owes `forgetWorkspaceAgent(id)` beside it:
 * the id is free again, and re-adding the same label would mint it a second time, so any
 * workspace still remembering it has to let go now or it would open with whatever the next
 * agent of that name is.
 */
export function removeAgentPatch(id: string, current: Settings): Partial<Settings> {
  return {
    customAgents: current.customAgents.filter((agent) => agent.id !== id),
    quickAgentIds: quickAgentsWithout(current.quickAgentIds, [id]),
  };
}
