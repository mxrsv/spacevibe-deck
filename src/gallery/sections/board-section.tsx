import {
  ArrowLeft,
  ArrowUp,
  ArrowsOutSimple,
  CaretDown,
  Folder,
  FolderPlus,
  GitBranch,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { AGENT_LOGOS } from "../../lib/agent-logos";
import { DesktopChrome } from "../../ui/desktop-chrome";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import {
  agentRailNavigationSpecimen,
  deckToolbarSpecimen,
  NOOP,
  repositoryScopedTabStripSpecimen,
  sidebarFrameActionsSpecimen,
} from "../chrome-fixtures";
import { SectionHead, Specimen } from "../specimen";
import { BoardComposer } from "../../open-board/board-composer";
import { EMPTY_DRAFT, startTaskProblem, type NewTaskDraft } from "../../launcher/new-task-draft";
import type { AgentOption } from "../../lib/agent-catalog";
import type { RecentWorkspace } from "../../lib/workspace-recents";

/**
 * Gallery-only mock for docs/specs/2026-08-23-new-task-launcher-design.md.
 * It deliberately owns no app signals and cannot materialize a pane.
 */

const WORKSPACES = [
  {
    path: "/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck",
    name: "spacevibe-deck",
    detail: "main · Claude Code",
  },
  {
    path: "/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-api",
    name: "spacevibe-api",
    detail: "main · Codex",
  },
  {
    path: "/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-academy",
    name: "spacevibe-academy",
    detail: "main · Claude Code",
  },
] as const;

const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
] as const;

const AGENT_MODELS: Readonly<Record<string, readonly { value: string; label: string }[]>> = {
  claude: [
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  ],
  codex: [
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
  opencode: [
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "openai/gpt-5.6", label: "GPT-5.6" },
  ],
};

const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
] as const;

function modelEffortOptions(models: readonly { value: string; label: string }[]) {
  return models.flatMap((model) =>
    EFFORTS.map((effort) => ({
      value: `${model.value}::${effort.value}`,
      label: `${model.label} · ${effort.label}`,
      model: model.value,
      effort: effort.value,
    })),
  );
}

interface LauncherFieldsProps {
  readonly id: string;
  readonly compact?: boolean;
  readonly initialPromptExpanded?: boolean;
  readonly showFullComposerAction?: boolean;
}

function AgentMark({ id }: { readonly id: string }) {
  const logo = AGENT_LOGOS[id];
  return logo === undefined ? (
    <span class="nt-agent-mark">{id.slice(0, 1).toUpperCase()}</span>
  ) : (
    <img class="nt-agent-mark" src={logo} alt="" />
  );
}

interface PromptFieldProps {
  readonly compact: boolean;
  readonly expanded: boolean;
  readonly id: string;
  readonly value: string;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onValueChange: (value: string) => void;
}

function PromptField(props: PromptFieldProps) {
  return (
    <>
      <div class="nt-composer__prompt-head">
        <label for={props.id}>What do you want the agent to do?</label>
        {props.compact ? (
          <button
            type="button"
            class="nt-text-action"
            onClick={() => props.onExpandedChange(!props.expanded)}
          >
            {props.expanded ? "Hide prompt" : "Add prompt"}
          </button>
        ) : null}
      </div>
      {props.expanded ? (
        <textarea
          id={props.id}
          class="nt-composer__textarea"
          rows={props.compact ? 3 : 5}
          value={props.value}
          onInput={(event) => props.onValueChange(event.currentTarget.value)}
        />
      ) : (
        <button
          type="button"
          class="nt-composer__prompt-collapsed"
          onClick={() => props.onExpandedChange(true)}
        >
          Open the agent first and type in its terminal
        </button>
      )}
    </>
  );
}

function WorkspaceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = WORKSPACES.find((entry) => entry.path === value) ?? WORKSPACES[0];
  return (
    <label class="nt-context-control nt-context-control--workspace">
      <DeckIcon icon={Folder} size={ROW_ICON} />
      <span class="nt-context-control__copy">
        <strong>{selected.name}</strong>
      </span>
      <DeckIcon icon={CaretDown} size={ROW_ICON} />
      <select
        aria-label="Workspace"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {WORKSPACES.map((entry) => (
          <option key={entry.path} value={entry.path}>
            {entry.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AgentSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = AGENTS.find((entry) => entry.id === value) ?? AGENTS[0];
  return (
    <label class="nt-context-control nt-context-control--agent">
      <AgentMark id={selected.id} />
      <span class="nt-context-control__copy">
        <strong>{selected.label}</strong>
      </span>
      <DeckIcon icon={CaretDown} size={ROW_ICON} />
      <select
        aria-label="Agent"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {AGENTS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RuntimeSelect({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { value: string; label: string }[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label class="nt-runtime-control">
      <span class="nt-runtime-select">
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <DeckIcon icon={CaretDown} size={ROW_ICON} />
      </span>
    </label>
  );
}

function RuntimeSummary({
  model,
  effort,
  onExpand,
}: {
  readonly model: string;
  readonly effort: string;
  readonly onExpand: () => void;
}) {
  return (
    <button
      type="button"
      class="nt-runtime-summary"
      aria-label={`Model ${model}, effort ${effort}`}
      onClick={onExpand}
    >
      <DeckIcon icon={SlidersHorizontal} size={ROW_ICON} />
      <span>
        {model} · {effort}
      </span>
      <DeckIcon icon={CaretDown} size={ROW_ICON} />
    </button>
  );
}

function ComposerActions({
  expanded,
  prompt,
  showFullComposerAction,
}: {
  expanded: boolean;
  prompt: string;
  showFullComposerAction: boolean;
}) {
  return (
    <div class="nt-composer__actions">
      {showFullComposerAction ? (
        <button type="button" class="nt-icon-action" aria-label="Open full composer">
          <DeckIcon icon={ArrowsOutSimple} size={ROW_ICON} />
        </button>
      ) : (
        <button type="button" class="nt-secondary-action">
          Open agent first
        </button>
      )}
      <button type="button" class="nt-primary-action" disabled={expanded && prompt.trim() === ""}>
        {expanded ? "Start task" : "Open agent"}
        <DeckIcon icon={ArrowUp} size={ROW_ICON} />
      </button>
    </div>
  );
}

function LauncherFields({
  id,
  compact = false,
  initialPromptExpanded = true,
  showFullComposerAction = false,
}: LauncherFieldsProps) {
  const promptExpanded = useSignal(initialPromptExpanded);
  const runtimeExpanded = useSignal(!compact);
  const prompt = useSignal("Review the new task flow and identify where users lose context.");
  const workspace = useSignal<string>(WORKSPACES[0].path);
  const agent = useSignal<string>("codex");
  const model = useSignal<string>(AGENT_MODELS.codex[0].value);
  const effort = useSignal<string>("low");
  const modelOptions = AGENT_MODELS[agent.value] ?? AGENT_MODELS.codex;
  const runtimeOptions = modelEffortOptions(modelOptions);
  const runtimeValue = `${model.value}::${effort.value}`;
  const modelLabel =
    modelOptions.find((option) => option.value === model.value)?.label ?? model.value;
  const effortLabel =
    EFFORTS.find((option) => option.value === effort.value)?.label ?? effort.value;
  return (
    <div class={`nt-composer ${compact ? "nt-composer--compact" : ""}`}>
      <PromptField
        compact={compact}
        expanded={promptExpanded.value}
        id={id}
        value={prompt.value}
        onExpandedChange={(value) => {
          promptExpanded.value = value;
        }}
        onValueChange={(value) => {
          prompt.value = value;
        }}
      />
      <div class={`nt-composer__context ${runtimeExpanded.value ? "is-expanded" : ""}`}>
        <WorkspaceSelect
          value={workspace.value}
          onChange={(value) => {
            workspace.value = value;
          }}
        />
        <AgentSelect
          value={agent.value}
          onChange={(value) => {
            agent.value = value;
            model.value = (AGENT_MODELS[value] ?? AGENT_MODELS.codex)[0].value;
          }}
        />
        {runtimeExpanded.value ? (
          <div class="nt-runtime-fields">
            <RuntimeSelect
              label="Model and effort"
              value={runtimeValue}
              options={runtimeOptions}
              onChange={(value) => {
                const selected = runtimeOptions.find((option) => option.value === value);
                if (selected !== undefined) {
                  model.value = selected.model;
                  effort.value = selected.effort;
                }
              }}
            />
          </div>
        ) : (
          <RuntimeSummary
            model={modelLabel}
            effort={effortLabel}
            onExpand={() => {
              runtimeExpanded.value = true;
            }}
          />
        )}
        <ComposerActions
          expanded={promptExpanded.value}
          prompt={prompt.value}
          showFullComposerAction={showFullComposerAction}
        />
      </div>
    </div>
  );
}

function RecentWorkspaces() {
  return (
    <section class="nt-recents">
      <div class="nt-recents__head">
        <span>Recent workspaces</span>
        <button type="button">View all</button>
      </div>
      <div class="nt-recents__list">
        {WORKSPACES.map((entry, index) => (
          <button type="button" class="nt-recent" key={entry.path}>
            <span class="nt-recent__mark">
              <DeckIcon icon={Folder} size={ROW_ICON} />
            </span>
            <span class="nt-recent__copy">
              <strong>{entry.name}</strong>
              <small>{entry.detail}</small>
            </span>
            <span class="nt-recent__time">{index === 0 ? "now" : `${index + 2}h`}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function OpenBoardComposer({ id }: { readonly id: string }) {
  return (
    <main class="nt-board" aria-label="New task composer mock">
      <div class="nt-board__content">
        <header class="nt-board__head">
          <span>New task</span>
          <h2>Start something new</h2>
          <p>Describe the outcome. Deck opens the agent in the right workspace and sends it.</p>
        </header>
        <LauncherFields id={id} />
        <div class="nt-board__shortcuts">
          <button type="button">
            <DeckIcon icon={FolderPlus} size={ROW_ICON} /> Open folder…
          </button>
          <button type="button">
            <DeckIcon icon={FolderPlus} size={ROW_ICON} /> Create workspace…
          </button>
          <button type="button">
            <DeckIcon icon={GitBranch} size={ROW_ICON} /> Create worktree…
          </button>
        </div>
        <RecentWorkspaces />
      </div>
    </main>
  );
}

function QuickLaunch({
  id,
  collapsed = false,
}: {
  readonly id: string;
  readonly collapsed?: boolean;
}) {
  return (
    <aside class="nt-quick-launch" aria-label="Quick launch mock">
      <header class="nt-quick-launch__head">
        <div>
          <span>Quick launch</span>
          <strong>New task</strong>
        </div>
        <button type="button" class="nt-icon-action" aria-label="Close">
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      </header>
      <LauncherFields id={id} compact initialPromptExpanded={!collapsed} showFullComposerAction />
      <footer class="nt-quick-launch__foot">
        <span>
          <kbd>⌘</kbd>
          <kbd>↵</kbd> start
        </span>
        <button type="button">Manage agents…</button>
      </footer>
    </aside>
  );
}

function CreateWorkspaceSubview() {
  return (
    <aside class="nt-quick-launch nt-create-workspace" aria-label="Create workspace mock">
      <header class="nt-quick-launch__head">
        <button type="button" class="nt-icon-action" aria-label="Back">
          <DeckIcon icon={ArrowLeft} size={ROW_ICON} />
        </button>
        <div>
          <span>Workspace</span>
          <strong>Create workspace</strong>
        </div>
        <button type="button" class="nt-icon-action" aria-label="Close">
          <DeckIcon icon={X} size={ROW_ICON} />
        </button>
      </header>
      <div class="nt-create-workspace__body">
        <label>
          <span>Parent folder</span>
          <button type="button" class="nt-create-workspace__folder">
            <DeckIcon icon={Folder} size={ROW_ICON} />
            ~/Documents/Development
            <span>Choose…</span>
          </button>
        </label>
        <label>
          <span>Folder name</span>
          <input type="text" value="new-agent-workspace" />
        </label>
        <p>Creates an empty folder. No Git repository or starter files are added.</p>
      </div>
      <footer class="nt-create-workspace__foot">
        <button type="button" class="nt-secondary-action">
          Cancel
        </button>
        <button type="button" class="nt-primary-action">
          Create workspace
          <DeckIcon icon={ArrowUp} size={ROW_ICON} />
        </button>
      </footer>
    </aside>
  );
}

function TerminalReviewSurface({ children }: { readonly children: ComponentChildren }) {
  return (
    <main class="stage stage--strip nt-stage">
      <div class="stage__strip" data-tauri-drag-region>
        {repositoryScopedTabStripSpecimen()}
        <div class="stage__strip-actions">{deckToolbarSpecimen()}</div>
      </div>
      <div class="stage__tabs nt-terminal">
        <div class="nt-terminal__conversation">
          <span class="nt-terminal__prompt">❯</span>
          <p>Review the launcher flow before we change production behavior.</p>
          <span class="nt-terminal__agent">Claude Code</span>
          <p>
            The current flow starts work too early. Selecting a workspace should establish context,
            while the final Start action should be the only point that creates a session.
          </p>
          <p>
            I would keep Open Board as the deliberate composer and make the contextual path a
            non-modal tool so this reasoning remains readable while the next task is drafted.
          </p>
          <span class="nt-terminal__cursor" aria-hidden="true" />
        </div>
      </div>
      {children}
    </main>
  );
}

function DeckShell({
  board = false,
  compact = false,
  children,
}: {
  readonly board?: boolean;
  readonly compact?: boolean;
  readonly children: ComponentChildren;
}) {
  return (
    <div
      class={`gx-chatgpt-direction gx-new-task-direction ${board ? "gx-open-board-direction" : ""} ${compact ? "gx-new-task-direction--compact" : ""}`}
    >
      <DesktopChrome
        sidebar
        sidebarToggle={sidebarFrameActionsSpecimen()}
        toolbar={null}
        sidebarNavigation={board && !compact ? null : agentRailNavigationSpecimen()}
        topTabs={null}
        stage={children}
        status={null}
        onMacTitlebarDoubleClick={NOOP}
      />
    </div>
  );
}

function FullComposerSpecimen() {
  return (
    <Specimen
      name="Open Board · full composer"
      note="prompt is the focal artifact · context stays attached · recents select, never launch"
      surface="none"
      tall
    >
      <DeckShell board>
        <div class="stage nt-stage nt-stage--board">
          <OpenBoardComposer id="board-task-prompt-wide" />
        </div>
      </DeckShell>
    </Specimen>
  );
}

function CompactComposerSpecimen() {
  return (
    <Specimen
      name="Open Board · compact with live rail"
      note="same hierarchy at a narrow review width · live work remains one click away"
      surface="none"
      tall
    >
      <div class="nt-compact-frame">
        <DeckShell board compact>
          <div class="stage nt-stage nt-stage--board">
            <OpenBoardComposer id="board-task-prompt-compact" />
          </div>
        </DeckShell>
      </div>
    </Specimen>
  );
}

function QuickPromptSpecimen() {
  return (
    <Specimen
      name="Quick Launch · prompt first"
      note="no scrim · no blur · terminal remains readable and interactive"
      surface="none"
      tall
    >
      <DeckShell>
        <TerminalReviewSurface>
          <QuickLaunch id="quick-task-prompt-expanded" />
        </TerminalReviewSurface>
      </DeckShell>
    </Specimen>
  );
}

function QuickAgentSpecimen() {
  return (
    <Specimen
      name="Quick Launch · agent first"
      note="remembered collapsed state · the same panel becomes a fast Open agent path"
      surface="none"
      tall
    >
      <DeckShell>
        <TerminalReviewSurface>
          <QuickLaunch id="quick-task-prompt-collapsed" collapsed />
        </TerminalReviewSurface>
      </DeckShell>
    </Specimen>
  );
}

function CreateWorkspaceSpecimen() {
  return (
    <Specimen
      name="Quick Launch · create workspace subview"
      note="in-place subview · task draft stays intact · creation only selects a destination"
      surface="none"
      tall
    >
      <DeckShell>
        <TerminalReviewSurface>
          <CreateWorkspaceSubview />
        </TerminalReviewSurface>
      </DeckShell>
    </Specimen>
  );
}

/**
 * The REAL `BoardComposer`, not the mock above it — same section on purpose, so
 * the approved treatment and the shipped component can be read side by side.
 *
 * It is still driven from here: the gallery owns the draft in a local signal,
 * and every launch callback is a no-op. Nothing in this file can materialize a
 * pane (R7 runs app → gallery, never the reverse).
 */
function LiveComposerSpecimen() {
  const draft = useSignal<NewTaskDraft>({
    ...EMPTY_DRAFT,
    prompt: "Review the new task flow and identify where users lose context.",
    workspacePath: WORKSPACES[0].path,
    agentId: "claude",
  });
  const agents: readonly AgentOption[] = AGENTS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    detail: `/usr/local/bin/${entry.id}`,
    missing: false,
  }));
  const recents: readonly RecentWorkspace[] = WORKSPACES.map((entry, index) => ({
    path: entry.path,
    lastOpenedAt: WORKSPACES.length - index,
  }));
  const problem = startTaskProblem(draft.value, {
    runnableAgentIds: agents.map((agent) => agent.id),
    unavailableAgentIds: [],
  });
  return (
    <Specimen
      name="Open Board · the real component"
      note="src/open-board/board-composer.tsx with real agents, real recents and the real runtime catalog"
      surface="none"
      tall
    >
      <DeckShell board>
        <div class="stage nt-stage nt-stage--board">
          <BoardComposer
            draft={draft.value}
            agents={agents}
            recents={recents}
            declaredModels={{ claude: ["opus", "sonnet"] }}
            agentRuntimeDefaults={{}}
            canCreateWorkspace
            canCreateWorktree
            pending={null}
            problem={problem}
            notice={null}
            onDraftChange={(next) => {
              draft.value = next;
            }}
            onSelectWorkspace={(path) => {
              draft.value = { ...draft.value, workspacePath: path };
            }}
            onPickFolder={NOOP}
            onCreateWorkspace={NOOP}
            onCreateWorktree={NOOP}
            onManageAgents={NOOP}
            onStartTask={NOOP}
            onOpenAgent={NOOP}
          />
        </div>
      </DeckShell>
    </Specimen>
  );
}

export function BoardSection() {
  return (
    <>
      <SectionHead
        title="New task launcher"
        blurb="One launch contract in two surfaces: Open Board for deliberate composition, Quick Launch for contextual work without losing the live agent behind it."
      />
      <LiveComposerSpecimen />
      <FullComposerSpecimen />
      <CompactComposerSpecimen />
      <QuickPromptSpecimen />
      <QuickAgentSpecimen />
      <CreateWorkspaceSpecimen />
    </>
  );
}
