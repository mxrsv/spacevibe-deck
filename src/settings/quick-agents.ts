import type { AgentOption } from "../lib/agent-catalog";

export const MAX_QUICK_AGENTS = 5;

/** Null keeps automatic defaults; an empty list deliberately selects none. */
export function validateQuickAgentIds(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  return [...new Set(ids)].slice(0, MAX_QUICK_AGENTS);
}

/** Filter availability before applying the automatic limit, without replacing saved picks. */
export function quickAgentOptions(
  options: readonly AgentOption[],
  selectedIds: readonly string[] | null,
): readonly AgentOption[] {
  const available = options.filter((agent) => !agent.missing);
  const selected = validateQuickAgentIds(selectedIds);
  if (selected === null) return available.slice(0, MAX_QUICK_AGENTS);
  const byId = new Map(available.map((agent) => [agent.id, agent]));
  return selected.flatMap((id) => {
    const agent = byId.get(id);
    return agent === undefined ? [] : [agent];
  });
}
