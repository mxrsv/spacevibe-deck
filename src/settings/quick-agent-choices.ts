import { agentOptions, BUILTIN_AGENTS } from "../lib/agent-catalog";
import { agentsProbed, detectedAgents } from "../terminal/agent-detection-store";
import { MAX_QUICK_AGENTS, quickAgentOptions } from "./quick-agents";
import { settings, updateSettings } from "./settings-store";

/** One agent as the quick-list editors show it: pinned or not, and why not toggleable. */
export interface QuickAgentChoice {
  readonly id: string;
  readonly label: string;
  readonly pinned: boolean;
  /** Why the agent cannot be pinned right now; null when it can. */
  readonly blocked: string | null;
  /** An unpinned agent needs `blocked === null`; a pinned one can always be dropped. */
  readonly toggleable: boolean;
}

/**
 * Every agent Deck knows plus any saved id nothing declares anymore, in the
 * catalog's order. The one list behind Settings → Quick agents and the quick
 * launcher's agent editor, so the two never disagree about what is pinned.
 */
export function quickAgentChoices(): readonly QuickAgentChoice[] {
  const current = settings.value;
  const options = agentOptions(detectedAgents.value, current.customAgents, current.disabledAgents);
  const selected =
    current.quickAgentIds ?? quickAgentOptions(options, null).map((agent) => agent.id);
  const catalog = [...BUILTIN_AGENTS, ...current.customAgents];
  const stale = selected
    .filter((id) => !catalog.some((agent) => agent.id === id))
    .map((id) => ({ id, label: id }));
  const probed = agentsProbed.value;
  return [...catalog, ...stale].map((agent) => {
    const pinned = selected.includes(agent.id);
    const available = options.some((option) => option.id === agent.id && !option.missing);
    const blocked = !probed
      ? "Looking for installed agents…"
      : current.disabledAgents.includes(agent.id)
        ? "Disabled in agent settings"
        : !available
          ? "Not installed"
          : !pinned && selected.length >= MAX_QUICK_AGENTS
            ? "Deselect an agent to add this one"
            : null;
    return {
      id: agent.id,
      label: agent.label,
      pinned,
      blocked,
      toggleable: probed && (pinned || blocked === null),
    };
  });
}

/** Pin or unpin one agent; ignores a request the choice says it cannot honour. */
export function toggleQuickAgent(id: string): void {
  const choice = quickAgentChoices().find((candidate) => candidate.id === id);
  if (choice === undefined || !choice.toggleable) return;
  const latest = settings.value;
  const options = agentOptions(detectedAgents.value, latest.customAgents, latest.disabledAgents);
  const ids = latest.quickAgentIds ?? quickAgentOptions(options, null).map((agent) => agent.id);
  updateSettings({
    quickAgentIds: choice.pinned ? ids.filter((candidate) => candidate !== id) : [...ids, id],
  });
}
