import { useSignal } from "@preact/signals";
import { Plus } from "@phosphor-icons/react";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { FIXTURE_GROUPS, agentName, spareAgent, type MockAgent } from "./agent-overview-data";
import { EXPAND_RATIO, FocusToggle, MockPane } from "./agent-overview-pane";

/**
 * Candidate B — two stable regions, each showing one agent picked from a
 * selector. Picking the agent the other region shows swaps the two, so no
 * agent is ever drawn twice; New agent joins a region's stack without a split.
 * The view/session binding this implies is exactly what the gallery does not
 * model — production would need its own ownership and restore design.
 */

type RegionIndex = 0 | 1;
type Pair<T> = readonly [T, T];

const REGION_NAMES: Pair<string> = ["Left", "Right"];

interface RegionState {
  readonly agents: readonly MockAgent[];
  readonly stacks: Pair<readonly string[]>;
  readonly visible: Pair<string | null>;
}

function initialRegions(agents: readonly MockAgent[]): RegionState {
  const stacks: Pair<readonly string[]> = [
    agents.filter((_, index) => index % 2 === 0).map((agent) => agent.key),
    agents.filter((_, index) => index % 2 === 1).map((agent) => agent.key),
  ];
  return { agents, stacks, visible: [stacks[0][0] ?? null, stacks[1][0] ?? null] };
}

function withAt<T>(pair: Pair<T>, index: RegionIndex, value: T): Pair<T> {
  return index === 0 ? [value, pair[1]] : [pair[0], value];
}

function show(state: RegionState, region: RegionIndex, key: string): RegionState {
  const other: RegionIndex = region === 0 ? 1 : 0;
  const visible =
    state.visible[other] === key
      ? withAt(withAt(state.visible, other, state.visible[region]), region, key)
      : withAt(state.visible, region, key);
  return { ...state, visible };
}

function addTo(state: RegionState, region: RegionIndex): RegionState {
  const added = spareAgent(state.agents, state.agents[0]?.groupId ?? FIXTURE_GROUPS[0].id);
  return {
    agents: [...state.agents, added],
    stacks: withAt(state.stacks, region, [...state.stacks[region], added.key]),
    visible: withAt(state.visible, region, added.key),
  };
}

interface RegionProps {
  readonly index: RegionIndex;
  readonly state: RegionState;
  readonly active: boolean;
  readonly onShow: (key: string) => void;
  readonly onNew: () => void;
  readonly onActivate: () => void;
}

function SelectorItem({
  agent,
  here,
  elsewhere,
  onShow,
}: {
  agent: MockAgent;
  here: boolean;
  elsewhere: string | null;
  onShow: (key: string) => void;
}) {
  return (
    <button
      type="button"
      class={`aog-pick ${elsewhere === null ? "" : "is-elsewhere"}`}
      data-state={agent.state}
      aria-pressed={here}
      title={
        elsewhere === null
          ? `${agentName(agent)} · ${agent.task}`
          : `${agentName(agent)} · shown ${elsewhere.toLowerCase()} · swaps`
      }
      onClick={() => onShow(agent.key)}
    >
      <AgentGlyph agent={agent.cli} className="aog-glyph" />
      <span>{agentName(agent)}</span>
      <small class="aog-pick__state">{agent.state}</small>
    </button>
  );
}

function Region({ index, state, active, onShow, onNew, onActivate }: RegionProps) {
  const other: RegionIndex = index === 0 ? 1 : 0;
  const byKey = new Map(state.agents.map((agent) => [agent.key, agent]));
  const own = state.stacks[index].flatMap((key) => byKey.get(key) ?? []);
  const rest = state.stacks[other].flatMap((key) => byKey.get(key) ?? []);
  const shownKey = state.visible[index];
  const shown = shownKey === null ? undefined : byKey.get(shownKey);
  const item = (agent: MockAgent) => (
    <SelectorItem
      key={agent.key}
      agent={agent}
      here={agent.key === state.visible[index]}
      elsewhere={agent.key === state.visible[other] ? REGION_NAMES[other] : null}
      onShow={onShow}
    />
  );
  return (
    <section class="aog-region" aria-label={`${REGION_NAMES[index]} region`} onFocusIn={onActivate}>
      <div class="aog-region__picker" role="group" aria-label={`${REGION_NAMES[index]} agents`}>
        {own.map(item)}
        {rest.length > 0 && <span class="aog-region__divider" aria-hidden="true" />}
        {rest.map(item)}
        <button
          type="button"
          class="aog-tool"
          aria-label={`New agent in ${REGION_NAMES[index].toLowerCase()} region`}
          title="New agent here"
          onClick={onNew}
        >
          <DeckIcon icon={Plus} size={CHROME_ICON} />
        </button>
      </div>
      <div class="aog-region__view">
        {shown === undefined ? (
          <div class="aog-empty">
            <button type="button" class="aog-empty__new" onClick={onNew}>
              <DeckIcon icon={Plus} size={CHROME_ICON} /> New agent
            </button>
          </div>
        ) : (
          <MockPane agent={shown} selected={active} onSelect={onActivate} />
        )}
      </div>
    </section>
  );
}

export function RegionsCandidate({ agents }: { agents: readonly MockAgent[] }) {
  const state = useSignal<RegionState>(initialRegions(agents));
  const active = useSignal<RegionIndex>(0);
  const expand = useSignal(false);
  const weights: Pair<string> = expand.value
    ? withAt(["1fr", "1fr"], active.value, `${EXPAND_RATIO}fr`)
    : ["1fr", "1fr"];
  const regionProps = (index: RegionIndex) => ({
    index,
    state: state.value,
    active: active.value === index,
    onShow: (key: string) => {
      state.value = show(state.value, index, key);
      active.value = index;
    },
    onNew: () => {
      state.value = addTo(state.value, index);
      active.value = index;
    },
    onActivate: () => {
      active.value = index;
    },
  });
  return (
    <div class="aog-window">
      <div class="aog-bar">
        <span class="aog-bar__spacer" />
        <FocusToggle
          on={expand.value}
          onToggle={() => {
            expand.value = !expand.value;
          }}
        />
      </div>
      <div class="aog-stage">
        <div class="aog-regions" style={{ "--aog-w0": weights[0], "--aog-w1": weights[1] }}>
          <Region {...regionProps(0)} />
          <Region {...regionProps(1)} />
        </div>
      </div>
      <div class="aog-status" role="status">
        <span>2 regions</span>
        <span>
          {state.value.visible.filter((key) => key !== null).length} shown of{" "}
          {state.value.agents.length}
        </span>
      </div>
    </div>
  );
}
