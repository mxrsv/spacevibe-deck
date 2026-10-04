import type { QuickAgentChoice } from "../settings/quick-agent-choices";
import { MAX_QUICK_AGENTS } from "../settings/quick-agents";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import "./agent-launch-page.css";

export interface QuickAgentEditorProps {
  readonly choices: readonly QuickAgentChoice[];
  readonly onToggle: (agentId: string) => void;
}

/** Show or hide agents in the quick launcher; the cards above update as the boxes change. */
export function QuickAgentEditor({ choices, onToggle }: QuickAgentEditorProps) {
  const pinned = choices.filter((choice) => choice.pinned).length;
  return (
    <section class="agent-launch-page__editor" aria-label="Choose quick agents">
      <header>
        <strong>Show in quick launch</strong>
        <span>
          {pinned}/{MAX_QUICK_AGENTS}
        </span>
      </header>
      <ul>
        {choices.map((choice) => (
          <li key={choice.id}>
            <label>
              <input
                type="checkbox"
                checked={choice.pinned}
                disabled={!choice.toggleable}
                onChange={() => onToggle(choice.id)}
              />
              <AgentGlyph
                agent={choice.id.startsWith("custom:") ? choice.label : choice.id}
                className="agent-launch-page__logo"
              />
              <strong>{choice.label}</strong>
              {choice.blocked !== null && <span>{choice.blocked}</span>}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
