import { AgentLaunchCards } from "../launcher/agent-launch-cards";
import { launcherPendingLabel } from "../launcher/launcher-fields";
import { quickAgentOptions } from "../settings/quick-agents";
import { settings } from "../settings/settings-store";
import type { BoardComposerProps } from "./board-composer";
import { WorkspacePicker } from "./workspace-picker";
import "./board-agent-launcher.css";

/**
 * Workspace selection is separate from the explicit Run on each agent. The
 * cards are the pinned quick agents, the same list the launch page shows, then
 * any declared agent whose binary is gone: the board names it `Not installed`
 * where the launch page leaves it out.
 */
export function BoardAgentLauncher(props: BoardComposerProps) {
  const busy = props.pending !== null;
  const workspace = props.draft.workspacePath;
  const runnable = props.agents.filter((agent) => !agent.missing);
  const cards = [
    ...quickAgentOptions(props.agents, settings.value.quickAgentIds),
    ...props.agents.filter((agent) => agent.missing),
  ];
  return (
    <section class="nt-agent-launcher" aria-label="Choose an agent">
      <div class="nt-agent-launcher__destination">
        <WorkspacePicker
          value={workspace}
          paths={props.alive.map((recent) => recent.path)}
          homeDir={props.homeDir}
          disabled={busy}
          onSelect={props.onSelectWorkspace}
          onPickFolder={props.onPickFolder}
        />
        {/* Only a host that resolves dropped paths promises the drop. */}
        {props.canDropFolder ? (
          <span class="nt-agent-launcher__hint">or drop a folder here</span>
        ) : null}
      </div>
      {!props.agentsResolved ? <p role="status">Looking for installed agents…</p> : null}
      {props.agentsResolved && runnable.length === 0 ? (
        <p role="status">No agent is installed and enabled — open Settings to add one.</p>
      ) : null}
      <AgentLaunchCards
        agents={cards}
        pending={busy}
        disabled={!props.agentsResolved || workspace === null}
        onRun={props.onRunAgent}
        terminal
      />
      {props.pending !== null ? <p role="status">{launcherPendingLabel(props.pending)}</p> : null}
      {props.notice !== null ? <p role="alert">{props.notice}</p> : null}
      {workspace === null ? <p>Choose a folder before running an agent.</p> : null}
    </section>
  );
}
