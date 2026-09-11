import { agentOptions, BUILTIN_AGENTS, type AgentOption } from "../../lib/agent-catalog";
import { MAX_QUICK_AGENTS, quickAgentOptions } from "../../settings/quick-agents";
import { settings, updateSettings } from "../../settings/settings-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { ConfigGroup, ConfigRow, ToggleRow } from "../controls/config-row";

function toggleQuickAgent(id: string): void {
  const latest = settings.value;
  const available = agentOptions(detectedAgents.value, latest.customAgents, latest.disabledAgents);
  const ids = latest.quickAgentIds ?? quickAgentOptions(available, null).map((agent) => agent.id);
  if (ids.includes(id)) {
    updateSettings({ quickAgentIds: ids.filter((candidate) => candidate !== id) });
  } else if (
    ids.length < MAX_QUICK_AGENTS &&
    available.some((agent) => agent.id === id && !agent.missing)
  ) {
    updateSettings({ quickAgentIds: [...ids, id] });
  }
}

export function QuickAgentsSection() {
  const current = settings.value;
  const options = agentOptions(detectedAgents.value, current.customAgents, current.disabledAgents);
  const selected =
    current.quickAgentIds ?? quickAgentOptions(options, null).map((agent) => agent.id);
  const catalog = [...BUILTIN_AGENTS, ...current.customAgents];
  const rows = [
    ...catalog,
    ...selected
      .filter((id) => !catalog.some((agent) => agent.id === id))
      .map((id) => ({ id, label: id })),
  ];

  return (
    <section aria-label="Quick agents">
      <ConfigGroup label="Quick agents" />
      <ConfigRow label="Checkout menu" desc={`Choose up to ${MAX_QUICK_AGENTS} agents`}>
        <span class="cfg-row__desc">
          {selected.length}/{MAX_QUICK_AGENTS}
        </span>
      </ConfigRow>
      <div data-quick-agent-choices>
        {rows.map((agent) => (
          <QuickAgentRow key={agent.id} agent={agent} selected={selected} options={options} />
        ))}
      </div>
    </section>
  );
}

function QuickAgentRow({
  agent,
  selected,
  options,
}: {
  agent: { readonly id: string; readonly label: string };
  selected: readonly string[];
  options: readonly AgentOption[];
}) {
  const checked = selected.includes(agent.id);
  const available = options.some((option) => option.id === agent.id && !option.missing);
  const atLimit = selected.length >= MAX_QUICK_AGENTS;
  const desc = !agentsProbed.value
    ? "Looking for installed agents…"
    : settings.value.disabledAgents.includes(agent.id)
      ? "Disabled in agent settings"
      : !available
        ? "Not installed"
        : !checked && atLimit
          ? "Deselect an agent to add this one"
          : undefined;
  return (
    <ToggleRow
      label={agent.label}
      desc={desc}
      checked={checked}
      disabled={!agentsProbed.value || (!checked && (!available || atLimit))}
      onToggle={() => toggleQuickAgent(agent.id)}
    />
  );
}
