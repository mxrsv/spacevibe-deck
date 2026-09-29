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
  /**
   * When set, each installed agent's card offers two ways in — `Split` into
   * the current tab and `New space` — instead of one `Run`. Only the compact
   * launcher passes it, and only while the folder already has a tab to split;
   * the Open board's cards always start a tab of their own.
   */
  readonly onRunInNewSpace?: (agentId: string) => void;
}

/** DL-32.1 / DL-32.6: one card treatment on both launch surfaces. */
export function AgentLaunchCards(props: AgentLaunchCardsProps) {
  return (
    <div class="agent-launch-page__grid" aria-busy={props.pending}>
      {props.agents.map((agent) => {
        const blocked = props.pending || props.disabled || agent.missing;
        return (
          <article class="agent-launch-page__card" key={agent.id}>
            <AgentGlyph
              agent={agent.id.startsWith("custom:") ? agent.label : agent.id}
              className="agent-launch-page__logo"
            />
            <strong>{agent.label}</strong>
            {props.onRunInNewSpace !== undefined && !agent.missing ? (
              <div class="agent-launch-page__choices">
                <button
                  type="button"
                  data-launch-primary
                  disabled={blocked}
                  aria-label={`Split ${agent.label} into the current tab`}
                  onClick={() => props.onRun(agent.id)}
                >
                  Split
                </button>
                <button
                  type="button"
                  disabled={blocked}
                  aria-label={`Run ${agent.label} in a new space`}
                  onClick={() => props.onRunInNewSpace?.(agent.id)}
                >
                  New space
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-launch-primary
                disabled={blocked}
                aria-label={`Run ${agent.label}`}
                onClick={() => props.onRun(agent.id)}
              >
                {agent.missing ? "Not installed" : "Run"} <DeckIcon icon={ArrowRight} size={14} />
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
