import { AgentLaunchCards } from "../launcher/agent-launch-cards";
import { launcherPendingLabel } from "../launcher/launcher-fields";
import type { BoardComposerProps } from "./board-composer";
import { WorkspacePicker } from "./workspace-picker";
import "./board-agent-launcher.css";

/** Workspace selection is separate from the explicit Run on each agent. */
export function BoardAgentLauncher(props: BoardComposerProps) {
  const busy = props.pending !== null;
  const workspace = props.draft.workspacePath;
  const runnable = props.agents.filter((agent) => !agent.missing);
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
        agents={props.agents}
        pending={busy}
        disabled={!props.agentsResolved || workspace === null}
        onRun={props.onRunAgent}
      />
      {props.pending !== null ? <p role="status">{launcherPendingLabel(props.pending)}</p> : null}
      {props.notice !== null ? <p role="alert">{props.notice}</p> : null}
      {workspace === null ? <p>Choose a folder before running an agent.</p> : null}
    </section>
  );
}
