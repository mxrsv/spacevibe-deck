import { ArrowsOut } from "@phosphor-icons/react";
import { useLayoutEffect, useRef } from "preact/hooks";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import {
  agentName,
  cwdName,
  membersOf,
  needsYouCount,
  spaceName,
  spaceText,
  type LaunchPlan,
  type MockAgent,
  type MockGroup,
  type SpaceName,
} from "./agent-overview-data";

/**
 * Pieces shared by the reference and candidates A–C. Presentational only:
 * each candidate owns its signals and passes selection in and callbacks out.
 */

/** Share of the stage the focused column/row takes under mock Focus Expand. */
export const EXPAND_RATIO = 2;

export function StateWord({ agent }: { agent: MockAgent }) {
  return (
    <span class="aog-state" data-state={agent.state}>
      <i aria-hidden="true" />
      {agent.state}
    </span>
  );
}

/** A space's cwd as its name: folder, then its index on that cwd. */
export function CwdLabel({ name }: { name: SpaceName }) {
  return (
    <span class="aog-cwd" title={`${name.checkout.path} · ${name.checkout.branch}`}>
      <b>{cwdName(name.checkout)}</b>
      {name.index !== null && <small class="aog-cwd__index">{name.index}</small>}
    </span>
  );
}

export function AgentLabel({ agent }: { agent: MockAgent }) {
  return (
    <span class="aog-label">
      <AgentGlyph agent={agent.cli} className="aog-glyph" />
      <b>{agentName(agent)}</b>
    </span>
  );
}

interface MockPaneProps {
  readonly agent: MockAgent;
  readonly selected: boolean;
  readonly onSelect: (key: string) => void;
}

export function MockPane({ agent, selected, onSelect }: MockPaneProps) {
  return (
    <button
      type="button"
      class="aog-pane"
      data-key={agent.key}
      data-state={agent.state}
      aria-pressed={selected}
      aria-label={`${agentName(agent)} · ${agent.task} · ${agent.state}`}
      onClick={() => onSelect(agent.key)}
    >
      <span class="aog-pane__head">
        <AgentLabel agent={agent} />
        <span class="aog-pane__task">{agent.task}</span>
        <StateWord agent={agent} />
      </span>
      <span class="aog-pane__body">
        {agent.excerpt.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </span>
    </button>
  );
}

function tracks(count: number, focused: number, expand: boolean): string {
  return Array.from({ length: count }, (_, index) =>
    expand && index === focused ? `${EXPAND_RATIO}fr` : "1fr",
  ).join(" ");
}

interface PaneGridProps {
  readonly agents: readonly MockAgent[];
  readonly selectedKey: string | null;
  readonly expand: boolean;
  readonly onSelect: (key: string) => void;
}

/** One tab's panes; Focus Expand reweights the tracks, the structure stays. */
export function PaneGrid({ agents, selectedKey, expand, onSelect }: PaneGridProps) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(agents.length)));
  const rows = Math.max(1, Math.ceil(agents.length / cols));
  const index = agents.findIndex((agent) => agent.key === selectedKey);
  const style = {
    gridTemplateColumns: tracks(cols, index % cols, expand && index >= 0),
    gridTemplateRows: tracks(rows, Math.floor(index / cols), expand && index >= 0),
  };
  return (
    <div class="aog-grid" style={style}>
      {agents.map((agent) => (
        <MockPane
          key={agent.key}
          agent={agent}
          selected={agent.key === selectedKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface GroupStripProps {
  readonly groups: readonly MockGroup[];
  readonly agents: readonly MockAgent[];
  readonly currentId: string | null;
  readonly capacity: number;
  readonly onSelect: (groupId: string) => void;
}

/** Group chips; the strip scrolls inside itself instead of widening the frame. */
export function GroupStrip({ groups, agents, currentId, capacity, onSelect }: GroupStripProps) {
  return (
    <div class="aog-strip" role="group" aria-label="Tab groups">
      {groups.map((group) => {
        const members = membersOf(agents, group.id);
        const needs = needsYouCount(members);
        const over = members.length > capacity;
        const name = spaceName(group, groups);
        return (
          <button
            type="button"
            key={group.id}
            class="aog-chip"
            aria-pressed={group.id === currentId}
            aria-label={spaceText(name)}
            title={`${name.checkout.path}${over ? ` · ${members.length} panes, this frame fits ${capacity}` : ""}`}
            onClick={() => onSelect(group.id)}
          >
            <CwdLabel name={name} />
            <small class={over ? "is-over" : ""}>
              {members.length}/{capacity}
            </small>
            {needs > 0 && (
              <span class="aog-chip__needs" aria-label={`${needs} need you`}>
                {needs}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function FocusToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      class="aog-tool"
      aria-pressed={on}
      aria-label="Focus Expand"
      title="Focus Expand"
      onClick={onToggle}
    >
      <DeckIcon icon={ArrowsOut} size={CHROME_ICON} />
    </button>
  );
}

interface LaunchPanelProps {
  readonly plan: LaunchPlan;
  readonly groups: readonly MockGroup[];
  readonly capacity: number;
  readonly onLaunch: () => void;
  readonly onCancel: () => void;
}

/** Mock New agent's destination, shown before anything is added. */
export function LaunchPanel({ plan, groups, capacity, onLaunch, onCancel }: LaunchPanelProps) {
  const name = spaceName(plan.group, groups);
  const launchRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    launchRef.current?.focus();
  }, []);
  return (
    <div class="aog-launch" role="dialog" aria-label="New agent destination">
      <span class="aog-launch__dest">
        <CwdLabel name={name} />
      </span>
      <span class="aog-launch__checkout">
        {plan.kind === "join"
          ? `${plan.count} → ${plan.count + 1} of ${capacity}`
          : "New space · current is full"}
      </span>
      <span class="aog-launch__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" class="is-primary" onClick={onLaunch} ref={launchRef}>
          Launch
        </button>
      </span>
    </div>
  );
}

export function focusPane(root: HTMLElement | null, key: string | null): void {
  if (root === null || key === null) return;
  root.querySelector<HTMLElement>(`.aog-pane[data-key="${key}"]`)?.focus({ preventScroll: true });
}
