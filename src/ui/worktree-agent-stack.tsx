import { useSignal, type Signal } from "@preact/signals";
import type { JSX } from "preact";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import { AGENT_LOGOS } from "../lib/agent-logos";
import { letterAvatar } from "../lib/letter-avatar";
import type { PaneAgent } from "../lib/process-info";
import { tabDotCssColor } from "../lib/tab-colors";
import type { RailTab } from "../repositories/repository-model";

const MAX_VISIBLE_TABS = 3;

interface WorktreeAgentStackProps {
  readonly tabs: readonly RailTab[];
  readonly onSelectTab: (index: number) => void;
  readonly onOpenOptions?: (tab: RailTab, anchorEl: HTMLElement) => void;
}

function agentLabel(agent: PaneAgent): string {
  return (
    BUILTIN_AGENTS.find((candidate) => candidate.id === agent)?.label ?? agent
  );
}

function tabLabel(tab: RailTab): string {
  if (tab.customName !== null) {
    return tab.customName;
  }
  if (tab.agents.length > 0) {
    return tab.agents.map(agentLabel).join(" + ");
  }
  return tab.label;
}

function customAvatarStyle(color: string): JSX.CSSProperties {
  return {
    color,
    background: `color-mix(in srgb, ${color} 18%, var(--chrome-1))`,
  };
}

function visibleTabs(tabs: readonly RailTab[]): readonly RailTab[] {
  if (tabs.length <= MAX_VISIBLE_TABS) {
    return tabs;
  }
  const activeIndex = tabs.findIndex((tab) => tab.active);
  const focusIndex = activeIndex === -1 ? 0 : activeIndex;
  const start = Math.min(
    Math.max(focusIndex - 1, 0),
    tabs.length - MAX_VISIBLE_TABS,
  );
  return tabs.slice(start, start + MAX_VISIBLE_TABS);
}

function TabAgentMark({ tab }: { readonly tab: RailTab }) {
  const agent = tab.agents[0];
  const label = tabLabel(tab);
  const logo = agent === undefined ? undefined : AGENT_LOGOS[agent];
  const avatar = letterAvatar(label, agent ?? label);
  const color = tabDotCssColor(avatar.color);

  return logo === undefined ? (
    <span class="worktree-agents__letter" style={customAvatarStyle(color)}>
      {avatar.letter}
    </span>
  ) : (
    <img class="worktree-agents__logo" src={logo} alt="" />
  );
}

interface TabAgentButtonProps {
  readonly tab: RailTab;
  readonly onSelect: (tab: RailTab) => void;
  readonly onOpenOptions?: (tab: RailTab, anchorEl: HTMLElement) => void;
}

function TabAgentButton({ tab, onSelect, onOpenOptions }: TabAgentButtonProps) {
  const label = tabLabel(tab);
  return (
    <button
      type="button"
      class={`worktree-agents__item ${tab.active ? "is-active" : ""}`}
      aria-label={`Focus ${label}`}
      aria-current={tab.active ? "page" : undefined}
      title={label}
      data-key={tab.key}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(tab);
      }}
      onContextMenu={(event) => {
        if (onOpenOptions === undefined) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onOpenOptions(tab, event.currentTarget as HTMLElement);
      }}
    >
      <TabAgentMark tab={tab} />
    </button>
  );
}

interface MoreTabsButtonProps {
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}

function MoreTabsButton({ count, open, onToggle }: MoreTabsButtonProps) {
  if (count === 0) {
    return null;
  }
  return (
    <button
      type="button"
      class={`worktree-agents__more ${open ? "is-open" : ""}`}
      aria-label={`Show ${count} more agent ${count === 1 ? "tab" : "tabs"}`}
      aria-expanded={open}
      title={`${count} more tabs`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      +{count}
    </button>
  );
}

interface HiddenTabMenuProps {
  readonly tabs: readonly RailTab[];
  readonly onSelect: (tab: RailTab) => void;
}

function HiddenTabMenu({ tabs, onSelect }: HiddenTabMenuProps) {
  if (tabs.length === 0) {
    return null;
  }
  return (
    <span class="worktree-agents__menu" role="menu">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          class="worktree-agents__menu-item"
          role="menuitem"
          title={tabLabel(tab)}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(tab);
          }}
        >
          <span class="worktree-agents__menu-mark" aria-hidden="true">
            <TabAgentMark tab={tab} />
          </span>
          <span class="worktree-agents__menu-label">{tabLabel(tab)}</span>
        </button>
      ))}
    </span>
  );
}

interface AgentTabControlsProps {
  readonly tabs: readonly RailTab[];
  readonly visible: readonly RailTab[];
  readonly hidden: readonly RailTab[];
  readonly menuOpen: Signal<boolean>;
  readonly onSelect: (tab: RailTab) => void;
  readonly onOpenOptions?: (tab: RailTab, anchorEl: HTMLElement) => void;
}

function AgentTabControls(props: AgentTabControlsProps) {
  return (
    <span
      class="worktree-agents"
      role="group"
      aria-label={`${props.tabs.length} agent ${props.tabs.length === 1 ? "tab" : "tabs"} in this worktree`}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          props.menuOpen.value = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          props.menuOpen.value = false;
        }
      }}
    >
      {props.visible.map((tab) => (
        <TabAgentButton
          key={tab.key}
          tab={tab}
          onSelect={props.onSelect}
          onOpenOptions={props.onOpenOptions}
        />
      ))}
      <MoreTabsButton
        count={props.hidden.length}
        open={props.menuOpen.value}
        onToggle={() => {
          props.menuOpen.value = !props.menuOpen.value;
        }}
      />
      {props.menuOpen.value && (
        <HiddenTabMenu tabs={props.hidden} onSelect={props.onSelect} />
      )}
    </span>
  );
}

/** One focusable agent mark per terminal tab in a worktree. */
export function WorktreeAgentStack({
  tabs,
  onSelectTab,
  onOpenOptions,
}: WorktreeAgentStackProps) {
  const menuOpen = useSignal(false);
  if (tabs.length === 0) {
    return null;
  }

  const visible = visibleTabs(tabs);
  const visibleKeys = new Set(visible.map((tab) => tab.key));
  const hidden = tabs.filter((tab) => !visibleKeys.has(tab.key));

  function focusTab(tab: RailTab): void {
    menuOpen.value = false;
    onSelectTab(tab.index);
  }

  return (
    <AgentTabControls
      tabs={tabs}
      visible={visible}
      hidden={hidden}
      menuOpen={menuOpen}
      onSelect={focusTab}
      onOpenOptions={onOpenOptions}
    />
  );
}
