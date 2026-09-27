import type { ComponentChildren } from "preact";
import {
  ArrowLeft,
  ArrowRight,
  Columns,
  FolderSimple,
  Gear,
  GitBranch,
  Pulse,
} from "@phosphor-icons/react";
import type { PaneAgent } from "../../lib/process-info";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { DeckIcon } from "../../ui/controls/deck-icon";

/**
 * The redesigned launcher the four launch `after` columns share — a gallery
 * drawing, not `AgentLaunchPage`. One component with feature switches so the
 * four candidates read as one direction. Owner direction 2026-09-24: few
 * words, air over dividers, state by colour and shape first; explanations
 * live in `title` tooltips, placeholders and accessible names.
 */

export interface CandidateAgent {
  readonly id: PaneAgent;
  readonly label: string;
  /** The default command, printed in the risk mark's tooltip. */
  readonly command: string;
  readonly bypass: boolean;
  readonly installed: boolean;
  /** Remaining allowance in the current window, when the source reports one. */
  readonly limit?: { readonly left: number; readonly window: string; readonly resets: string };
}

export interface LauncherCandidateProps {
  readonly agents: readonly CandidateAgent[];
  /** The task field, pre-filled so the drawing shows the filled state. */
  readonly task?: string;
  /** Agents ticked for a task launch; with a task, cards fold into a checklist. */
  readonly selected?: readonly PaneAgent[];
  /** Destination switch: absent = no switch drawn; otherwise which side is on. */
  readonly destination?: "checkout" | "worktree";
  /** Show remaining allowance on each card. */
  readonly limits?: boolean;
  /** The icon button that offers Signals while status is inferred. */
  readonly signalsHint?: boolean;
}

const LOW_LIMIT = 15;
const WORKTREE_BRANCH = "feat/fix-login-redirect";

export function LauncherCandidate(props: LauncherCandidateProps) {
  const taskMode = props.task !== undefined;
  const selected = new Set(props.selected ?? []);
  const toWorktree = props.destination === "worktree";
  return (
    <div class="ba23l" data-task={taskMode ? "" : undefined}>
      <div class="ba23l__top">
        <button type="button" class="ba23l__icon" title="Back (Esc)" aria-label="Back">
          <DeckIcon icon={ArrowLeft} size={15} />
        </button>
        <span class="ba23l__tools">
          {props.signalsHint && (
            <button
              type="button"
              class="ba23l__icon ba23l__icon--hint"
              title="Status is guessed from terminal output. Turn on Signals for exact status."
              aria-label="Turn on Signals"
            >
              <DeckIcon icon={Pulse} size={15} />
            </button>
          )}
          <button
            type="button"
            class="ba23l__icon"
            title="Agent settings"
            aria-label="Agent settings"
          >
            <DeckIcon icon={Gear} size={15} />
          </button>
        </span>
      </div>
      <header class="ba23l__dest">
        <span class="ba23l__project">
          <DeckIcon icon={FolderSimple} size={16} />
          spacevibe-deck
        </span>
        <span class="ba23l__branch" data-new={toWorktree ? "" : undefined}>
          <DeckIcon icon={GitBranch} size={13} />
          {toWorktree ? WORKTREE_BRANCH : "main"}
        </span>
        <span
          class="ba23l__place"
          title={toWorktree ? "Opens in a new tab" : "Splits right of Claude Code, same tab"}
          aria-label={toWorktree ? "Opens in a new tab" : "Splits right of Claude Code, same tab"}
        >
          <DeckIcon icon={Columns} size={14} />
        </span>
      </header>
      {props.destination !== undefined && <DestinationSwitch worktree={toWorktree} />}
      {taskMode && <TaskField task={props.task ?? ""} />}
      <div class="ba23l__grid">
        {props.agents.map((agent, index) =>
          taskMode ? (
            <PickRow
              key={agent.id}
              agent={agent}
              digit={index + 1}
              selected={selected.has(agent.id)}
            />
          ) : (
            <AgentCard
              key={agent.id}
              agent={agent}
              digit={index + 1}
              limits={props.limits === true}
            />
          ),
        )}
      </div>
      {taskMode && <RunBar count={selected.size} />}
    </div>
  );
}

function DestinationSwitch({ worktree }: { readonly worktree: boolean }) {
  return (
    <div class="ba23l__wt">
      <div class="ba23l__seg" role="radiogroup" aria-label="Destination">
        <button type="button" role="radio" aria-checked={!worktree}>
          This checkout
        </button>
        <button type="button" role="radio" aria-checked={worktree}>
          New worktree
        </button>
      </div>
      {worktree && (
        <div
          class="ba23l__wt-fields"
          title="Created at ~/deck-worktrees/fix-login-redirect; the agent starts there"
        >
          <span class="ba23l__input" aria-label="Branch, suggested from the task">
            <DeckIcon icon={GitBranch} size={13} />
            {WORKTREE_BRANCH}
          </span>
          <span class="ba23l__from" aria-hidden="true">
            from
          </span>
          <span class="ba23l__input ba23l__input--base" aria-label="Base branch">
            main
          </span>
        </div>
      )}
    </div>
  );
}

function TaskField({ task }: { readonly task: string }) {
  return (
    <span
      class="ba23l__task"
      role="textbox"
      aria-label="Task"
      data-placeholder="What should the agent do? (optional)"
      title="Sent as the first message once the agent is ready. Leave empty to just open it."
    >
      {task}
      <span class="ba23l__caret" aria-hidden="true" />
    </span>
  );
}

/** A yellow mark that stays visible: the one risk a launch must not hide. */
function BypassMark({ agent }: { readonly agent: CandidateAgent }) {
  if (!agent.bypass) return null;
  const tip = `Skips approvals: ${agent.command}`;
  return <span class="ba23l__risk" title={tip} aria-label={tip} />;
}

function AgentCard({
  agent,
  digit,
  limits,
}: {
  readonly agent: CandidateAgent;
  readonly digit: number;
  readonly limits: boolean;
}) {
  const low = agent.limit !== undefined && agent.limit.left < LOW_LIMIT;
  if (!agent.installed) {
    const tip = `${agent.label} is not installed. Install ${agent.command.split(" ")[0]}, then refresh.`;
    return (
      <div class="ba23l__card" data-state="missing" title={tip} aria-label={tip}>
        <AgentGlyph agent={agent.id} className="ba23l__logo" />
        <strong>{agent.label}</strong>
      </div>
    );
  }
  return (
    <button
      type="button"
      class="ba23l__card"
      data-state={low && limits ? "low" : "ready"}
      aria-label={`Run ${agent.label}`}
    >
      <span class="ba23l__card-top">
        <AgentGlyph agent={agent.id} className="ba23l__logo" />
        <BypassMark agent={agent} />
      </span>
      <strong>{agent.label}</strong>
      {limits && agent.limit !== undefined && <LimitBar limit={agent.limit} low={low} />}
      <span class="ba23l__go" aria-hidden="true">
        <kbd>{digit}</kbd>
        <DeckIcon icon={ArrowRight} size={14} />
      </span>
    </button>
  );
}

function LimitBar({
  limit,
  low,
}: {
  readonly limit: NonNullable<CandidateAgent["limit"]>;
  readonly low: boolean;
}) {
  const tip = `${limit.left}% of the ${limit.window} window left · resets ${limit.resets}`;
  return (
    <span class="ba23l__limit" data-low={low ? "" : undefined} title={tip} aria-label={tip}>
      <span class="ba23l__bar" style={{ "--left": `${limit.left}%` }} />
      {limit.left}%
    </span>
  );
}

/** With a task the cards fold into a checklist so the field and Run stay in view. */
function PickRow({
  agent,
  digit,
  selected,
}: {
  readonly agent: CandidateAgent;
  readonly digit: number;
  readonly selected: boolean;
}) {
  if (!agent.installed) {
    return (
      <div class="ba23l__pick" data-state="missing" title={`${agent.label} is not installed`}>
        <span class="ba23l__tick" aria-hidden="true" />
        <AgentGlyph agent={agent.id} className="ba23l__pick-logo" />
        <span class="ba23l__pick-name">{agent.label}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      class="ba23l__pick"
      role="checkbox"
      aria-checked={selected}
      data-selected={selected ? "" : undefined}
    >
      <span class="ba23l__tick" aria-hidden="true" />
      <AgentGlyph agent={agent.id} className="ba23l__pick-logo" />
      <span class="ba23l__pick-name">{agent.label}</span>
      <BypassMark agent={agent} />
      <kbd>{digit}</kbd>
    </button>
  );
}

function RunBar({ count }: { readonly count: number }) {
  return (
    <div class="ba23l__runbar">
      <button
        type="button"
        class="ba23l__run"
        title={count > 1 ? `Same task in ${count} agents, tiled side by side` : undefined}
      >
        {count > 1 ? `Run ${count}` : "Run"} <kbd>⌘↵</kbd>
      </button>
    </div>
  );
}

/** A fixed-height box so the absolute-positioned launch page has a stage to fill. */
export function StageBox({ children }: { readonly children: ComponentChildren }) {
  return <div class="ba23l-stage">{children}</div>;
}
