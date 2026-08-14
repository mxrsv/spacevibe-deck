import type { JSX } from "preact";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import { AGENT_LOGOS } from "../lib/agent-logos";
import { letterAvatar } from "../lib/letter-avatar";
import type { PaneAgent } from "../lib/process-info";
import { tabDotCssColor } from "../lib/tab-colors";

const MAX_VISIBLE_AGENTS = 3;

interface WorktreeAgentStackProps {
  readonly agents: readonly PaneAgent[];
}

function agentLabel(agent: PaneAgent): string {
  return (
    BUILTIN_AGENTS.find((candidate) => candidate.id === agent)?.label ?? agent
  );
}

function customAvatarStyle(color: string): JSX.CSSProperties {
  return {
    color,
    background: `color-mix(in srgb, ${color} 18%, var(--chrome-1))`,
  };
}

/** Compact, stable agent identity readout for one worktree row. */
export function WorktreeAgentStack({ agents }: WorktreeAgentStackProps) {
  if (agents.length === 0) {
    return null;
  }

  const visible = agents.slice(0, MAX_VISIBLE_AGENTS);
  const hiddenCount = agents.length - visible.length;
  const labels = agents.map(agentLabel);

  return (
    <span
      class="worktree-agents"
      role="img"
      aria-label={`Agents in this worktree: ${labels.join(", ")}`}
      title={labels.join(" · ")}
    >
      {visible.map((agent) => {
        const logo = AGENT_LOGOS[agent];
        const avatar = letterAvatar(agentLabel(agent), agent);
        const color = tabDotCssColor(avatar.color);
        return (
          <span
            key={agent}
            class="worktree-agents__item"
            aria-hidden="true"
            style={logo === undefined ? customAvatarStyle(color) : undefined}
          >
            {logo === undefined ? (
              <span class="worktree-agents__letter">{avatar.letter}</span>
            ) : (
              <img class="worktree-agents__logo" src={logo} alt="" />
            )}
          </span>
        );
      })}
      {hiddenCount > 0 && (
        <span class="worktree-agents__more" aria-hidden="true">
          +{hiddenCount}
        </span>
      )}
    </span>
  );
}
