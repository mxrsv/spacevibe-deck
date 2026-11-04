import {
  Clock01Icon,
  Download04Icon,
  FolderAddIcon,
  GitBranchIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { AgentLaunchCards } from "../launcher/agent-launch-cards";
import { launcherPendingLabel } from "../launcher/launcher-fields";
import { quickAgentOptions } from "../settings/quick-agents";
import { settings } from "../settings/settings-store";
import type { BoardComposerProps } from "./board-composer";
import { DeckIcon, GLYPH_ROW } from "../ui/controls/deck-icon";
import { WorkspacePicker, type WorkspacePickerAction } from "./workspace-picker";
import "./board-agent-launcher.css";

/** The three actions people reach for most, shown as buttons beside the folder bar. */
const PROMOTED_ACTIONS: readonly string[] = ["open-folder", "clone-repository", "create-worktree"];

/**
 * Every workspace action the board offers, in menu order; a host that cannot do
 * one omits it (DL-19.7). The promoted ones become buttons, the rest stay in the
 * folder menu.
 */
function boardActions(props: BoardComposerProps): readonly WorkspacePickerAction[] {
  return [
    {
      id: "open-folder",
      label: "Open folder…",
      icon: FolderAddIcon,
      onActivate: props.onPickFolder,
    },
    props.canCreateWorkspace
      ? {
          id: "create-workspace",
          label: "Create workspace…",
          icon: FolderAddIcon,
          onActivate: props.onCreateWorkspace,
        }
      : null,
    props.canCloneRepository === true && props.onCloneRepository !== undefined
      ? {
          id: "clone-repository",
          label: "Clone repository…",
          icon: Download04Icon,
          onActivate: props.onCloneRepository,
        }
      : null,
    props.canCreateWorktree
      ? {
          id: "create-worktree",
          label: "Create worktree…",
          icon: GitBranchIcon,
          onActivate: props.onCreateWorktree,
        }
      : null,
    props.canBrowseSessions
      ? {
          id: "resume-session",
          label: "Resume a session…",
          icon: Clock01Icon,
          onActivate: props.onBrowseSessions,
        }
      : null,
    {
      id: "manage-agents",
      label: "Manage agents",
      icon: Settings02Icon,
      onActivate: props.onManageAgents,
    },
  ].filter((action): action is WorkspacePickerAction => action !== null);
}

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
  const actions = boardActions(props);
  const promoted = PROMOTED_ACTIONS.flatMap((id) => actions.filter((action) => action.id === id));
  const menuActions = actions.filter((action) => !PROMOTED_ACTIONS.includes(action.id));
  const cards = [
    ...quickAgentOptions(props.agents, settings.value.quickAgentIds),
    ...props.agents.filter((agent) => agent.missing),
  ];
  return (
    <section class="nt-agent-launcher" aria-label="Choose an agent">
      <div class="nt-agent-launcher__bar">
        <div class="nt-agent-launcher__destination">
          <WorkspacePicker
            value={workspace}
            paths={props.alive.map((recent) => recent.path)}
            homeDir={props.homeDir}
            disabled={busy}
            onSelect={props.onSelectWorkspace}
            onPickFolder={props.onPickFolder}
            actions={menuActions}
            hideOpenFolder
          />
          {/* Only a host that resolves dropped paths promises the drop. */}
          {props.canDropFolder ? (
            <span class="nt-agent-launcher__hint">or drop files or folders here</span>
          ) : null}
        </div>
        <div class="nt-agent-launcher__actions" role="group" aria-label="Workspace actions">
          {promoted.map((action) => (
            <button
              key={action.id}
              type="button"
              class="nt-agent-launcher__action"
              disabled={busy}
              title={action.label}
              aria-label={action.label}
              onClick={action.onActivate}
            >
              <DeckIcon icon={action.icon} size={GLYPH_ROW} />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
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
