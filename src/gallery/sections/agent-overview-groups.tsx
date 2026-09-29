import { useSignal, type Signal } from "@preact/signals";
import type { ComponentChildren, Ref } from "preact";
import { Plus } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import {
  applyLaunch,
  checkoutOf,
  groupsFor,
  membersOf,
  planLaunch,
  type GroupState,
  type MockAgent,
} from "./agent-overview-data";
import { FocusToggle, GroupStrip, LaunchPanel, PaneGrid } from "./agent-overview-pane";

/**
 * Candidate A — bounded tab groups. Also the base C draws its overview over,
 * which is how the A + C composition is demonstrated without a fifth frame.
 */

export interface GroupDemo {
  readonly state: Signal<GroupState>;
  readonly current: Signal<string | null>;
  readonly selected: Signal<string | null>;
  readonly expand: Signal<boolean>;
  readonly launchOpen: Signal<boolean>;
}

export function useGroupDemo(agents: readonly MockAgent[]): GroupDemo {
  const groups = groupsFor(agents);
  const first = groups[0]?.id ?? null;
  return {
    state: useSignal<GroupState>({ groups, agents }),
    current: useSignal(first),
    selected: useSignal(first === null ? null : (membersOf(agents, first)[0]?.key ?? null)),
    expand: useSignal(false),
    launchOpen: useSignal(false),
  };
}

export function selectGroup(demo: GroupDemo, groupId: string): void {
  const members = membersOf(demo.state.value.agents, groupId);
  demo.current.value = groupId;
  if (!members.some((agent) => agent.key === demo.selected.value)) {
    demo.selected.value = members[0]?.key ?? null;
  }
}

export function launchAgent(demo: GroupDemo, capacity: number): void {
  const { groups, agents } = demo.state.value;
  const plan = planLaunch(groups, agents, demo.current.value, capacity);
  const next = applyLaunch(demo.state.value, plan);
  demo.state.value = { groups: next.groups, agents: next.agents };
  demo.current.value = plan.group.id;
  demo.selected.value = next.added.key;
  demo.launchOpen.value = false;
}

interface GroupsWindowProps {
  readonly demo: GroupDemo;
  readonly capacity: number;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly tools?: ComponentChildren;
  readonly overlay?: ComponentChildren;
  /** Sees every key first; returning true stops the window's own Escape handling. */
  readonly onKey?: (event: KeyboardEvent) => boolean;
  /** Replaces the group chips, for candidates whose groups are not tabs. */
  readonly barLead?: ComponentChildren;
  /** Replaces the current group's pane grid while any group exists. */
  readonly stage?: ComponentChildren;
}

export function GroupsWindow({
  demo,
  capacity,
  rootRef,
  tools,
  overlay,
  onKey,
  barLead,
  stage,
}: GroupsWindowProps) {
  const { groups, agents } = demo.state.value;
  const group = groups.find((item) => item.id === demo.current.value) ?? null;
  const members = group === null ? [] : membersOf(agents, group.id);
  const checkout = group === null ? null : checkoutOf(group.checkoutId);
  const over = members.length > capacity;
  const newRef = useRef<HTMLButtonElement>(null);
  const openLaunch = () => {
    demo.launchOpen.value = !demo.launchOpen.value;
  };
  const cancelLaunch = () => {
    if (!demo.launchOpen.value) return;
    demo.launchOpen.value = false;
    newRef.current?.focus();
  };
  return (
    <div
      ref={rootRef}
      class="aog-window"
      onKeyDown={(event) => {
        if (onKey?.(event) === true) return;
        if (event.key === "Escape") cancelLaunch();
      }}
    >
      <div class="aog-bar">
        {barLead ?? (
          <GroupStrip
            groups={groups}
            agents={agents}
            currentId={demo.current.value}
            capacity={capacity}
            onSelect={(id) => selectGroup(demo, id)}
          />
        )}
        {tools}
        <FocusToggle
          on={demo.expand.value}
          onToggle={() => {
            demo.expand.value = !demo.expand.value;
          }}
        />
        <button
          type="button"
          class="aog-tool"
          ref={newRef}
          aria-label="New agent"
          title="New agent"
          aria-expanded={demo.launchOpen.value}
          onClick={openLaunch}
        >
          <DeckIcon icon={Plus} size={CHROME_ICON} />
        </button>
        {demo.launchOpen.value && (
          <LaunchPanel
            plan={planLaunch(groups, agents, demo.current.value, capacity)}
            groups={groups}
            capacity={capacity}
            onLaunch={() => launchAgent(demo, capacity)}
            onCancel={cancelLaunch}
          />
        )}
      </div>
      <div class="aog-stage">
        {stage !== undefined && groups.length > 0 ? (
          stage
        ) : members.length === 0 ? (
          <div class="aog-empty">
            <button type="button" class="aog-empty__new" onClick={openLaunch}>
              <DeckIcon icon={Plus} size={CHROME_ICON} /> New agent
            </button>
          </div>
        ) : (
          <PaneGrid
            agents={members}
            selectedKey={demo.selected.value}
            expand={demo.expand.value}
            onSelect={(key) => {
              demo.selected.value = key;
            }}
          />
        )}
        {overlay}
      </div>
      <div class="aog-status" role="status">
        <span>{checkout === null ? "No agents" : checkout.path}</span>
        {over && (
          <span class="aog-status__flag">
            {members.length} panes · fits {capacity} · review
          </span>
        )}
        <span>
          {members.length} of {agents.length}
        </span>
      </div>
    </div>
  );
}

export function TabGroupsCandidate({
  agents,
  capacity,
}: {
  agents: readonly MockAgent[];
  capacity: number;
}) {
  const demo = useGroupDemo(agents);
  return <GroupsWindow demo={demo} capacity={capacity} />;
}
