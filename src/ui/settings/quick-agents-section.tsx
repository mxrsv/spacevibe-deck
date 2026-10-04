import { quickAgentChoices, toggleQuickAgent } from "../../settings/quick-agent-choices";
import { MAX_QUICK_AGENTS } from "../../settings/quick-agents";
import { ConfigGroup, ConfigRow, ToggleRow } from "../controls/config-row";

export function QuickAgentsSection() {
  const choices = quickAgentChoices();
  const pinned = choices.filter((choice) => choice.pinned).length;

  return (
    <section aria-label="Quick agents">
      <ConfigGroup label="Quick agents" />
      <ConfigRow
        label="Pinned agents"
        desc={`Up to ${MAX_QUICK_AGENTS}, in quick launch and the checkout menu`}
      >
        <span class="cfg-row__desc">
          {pinned}/{MAX_QUICK_AGENTS}
        </span>
      </ConfigRow>
      <div data-quick-agent-choices>
        {choices.map((choice) => (
          <ToggleRow
            key={choice.id}
            label={choice.label}
            desc={choice.blocked ?? undefined}
            checked={choice.pinned}
            disabled={!choice.toggleable}
            onToggle={() => toggleQuickAgent(choice.id)}
          />
        ))}
      </div>
    </section>
  );
}
