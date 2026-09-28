import { ArrowRight } from "@phosphor-icons/react";
import type { AgentOption } from "../lib/agent-catalog";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { DeckIcon } from "../ui/controls/deck-icon";
import "./agent-launch-page.css";

interface AgentLaunchCardsProps {
  readonly agents: readonly AgentOption[];
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly onRun: (agentId: string) => void;
}

/** DL-32.1 / DL-32.6: one card treatment on both launch surfaces. */
export function AgentLaunchCards(props: AgentLaunchCardsProps) {
  return (
    <div class="agent-launch-page__grid" aria-busy={props.pending}>
      {props.agents.map((agent) => (
        <article class="agent-launch-page__card" key={agent.id}>
          <AgentGlyph
            agent={agent.id.startsWith("custom:") ? agent.label : agent.id}
            className="agent-launch-page__logo"
          />
          <strong>{agent.label}</strong>
          <button
            type="button"
            data-launch-primary
            disabled={props.pending || props.disabled || agent.missing}
            aria-label={`Run ${agent.label}`}
            onClick={() => props.onRun(agent.id)}
          >
            {agent.missing ? "Not installed" : "Run"} <DeckIcon icon={ArrowRight} size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}
