import { useSignal } from "@preact/signals";
import { useLayoutEffect, useRef } from "preact/hooks";
import { applyThemeVars } from "../../lib/theme-vars";
import { DECK_DARK_ID, DECK_LIGHT_ID, getPreset } from "../../settings/themes";
import { SectionHead, Specimen } from "../specimen";
import {
  AGENT_COUNTS,
  DEMO_CAPACITY,
  agentsFor,
  type AgentCount,
  type FrameSize,
  type MockAgent,
} from "./agent-overview-data";
import { TabGroupsCandidate } from "./agent-overview-groups";
import { MissionCandidate } from "./agent-overview-mission";
import { EXPAND_RATIO, FocusToggle, PaneGrid } from "./agent-overview-pane";
import { RegionsCandidate } from "./agent-overview-regions";
import { DOT_STYLES, type DotStyle } from "./agent-overview-dots";
import "./agent-overview.css";

/**
 * Agent overview study, registered 2026-09-27 (local plan
 * `docs/plans/2026-09-27-agent-overview-gallery.md`). Four mock specimens over
 * one fixture: today's single tab with Focus Expand as the reference, then
 * bounded tab groups (A), stacked regions (B) and a Mission Control-style
 * overview (C). Every interaction is local signal state; New agent never
 * starts a process and no production store is read or written.
 */

type Appearance = "light" | "dark";

const THEME_IDS: Readonly<Record<Appearance, string>> = {
  light: DECK_LIGHT_ID,
  dark: DECK_DARK_ID,
};

interface Choice<T> {
  readonly value: T;
  readonly label: string;
}

function Segmented<T extends string | number>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="aog-control" role="group" aria-label={label}>
      <span>{label}</span>
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.value}
          aria-pressed={choice.value === value}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function ReferenceCandidate({ agents }: { agents: readonly MockAgent[] }) {
  const selected = useSignal<string | null>(agents[0]?.key ?? null);
  const expand = useSignal(true);
  return (
    <div class="aog-window">
      <div class="aog-bar">
        <div class="aog-strip">
          <span class="aog-chip" aria-current="true">
            <span>spacevibe-deck</span>
            <small>{agents.length}</small>
          </span>
        </div>
        <FocusToggle
          on={expand.value}
          onToggle={() => {
            expand.value = !expand.value;
          }}
        />
      </div>
      <div class="aog-stage">
        {agents.length === 0 ? (
          <div class="aog-empty">
            <span>No agents</span>
          </div>
        ) : (
          <PaneGrid
            agents={agents}
            selectedKey={selected.value}
            expand={expand.value}
            onSelect={(key) => {
              selected.value = key;
            }}
          />
        )}
      </div>
      <div class="aog-status" role="status">
        <span>1 tab</span>
        <span>{expand.value ? `Focus Expand ${EXPAND_RATIO} : 1` : "Even split"}</span>
        <span>{agents.length} panes</span>
      </div>
    </div>
  );
}

export function AgentOverviewSection() {
  const count = useSignal<AgentCount>(12);
  const appearance = useSignal<Appearance>("dark");
  const frame = useSignal<FrameSize>("wide");
  const dotStyle = useSignal<DotStyle>("pill");
  const themedRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (themedRef.current !== null)
      applyThemeVars(themedRef.current.style, getPreset(THEME_IDS[appearance.value]).theme);
  }, [appearance.value]);

  const agents = agentsFor(count.value);
  const capacity = DEMO_CAPACITY[frame.value];

  return (
    <div class="aog-study">
      <SectionHead
        title="Agent overview"
        blurb="Mock UI over one synthetic fixture. Compare the single tab with Focus Expand against bounded tab groups, stacked regions and a Mission Control-style overview."
      />
      <div class="aog-controls" aria-label="Review controls">
        <Segmented
          label="Agents"
          value={count.value}
          choices={AGENT_COUNTS.map((value) => ({ value, label: String(value) }))}
          onChange={(value) => {
            count.value = value;
          }}
        />
        <Segmented
          label="Appearance"
          value={appearance.value}
          choices={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(value) => {
            appearance.value = value;
          }}
        />
        <Segmented
          label="Frame"
          value={frame.value}
          choices={[
            { value: "wide", label: "Wide" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={(value) => {
            frame.value = value;
          }}
        />
        <Segmented
          label="Space marks (C)"
          value={dotStyle.value}
          choices={DOT_STYLES}
          onChange={(value) => {
            dotStyle.value = value;
          }}
        />
      </div>
      <div ref={themedRef} class={`aog-themed aog-frame--${frame.value}`}>
        <Specimen
          name="C · Mission Control"
          note="Mock UI. Tab groups become spaces laid side by side: ⌃← ⌃→, a horizontal two-finger swipe or the dots slide between them. ⌃↑ or the button zooms out to every space; press a window to zoom into it, a space to enter it, Esc or the empty area to return. Click inside the frame first so it has keyboard focus."
        >
          <MissionCandidate
            key={count.value}
            agents={agents}
            capacity={capacity}
            dotStyle={dotStyle.value}
          />
        </Specimen>
        <Specimen
          name="Reference · one tab"
          note="Mock UI. Today's model: every pane in one tab; Focus Expand reweights the tracks, the split tree stays."
        >
          <ReferenceCandidate key={count.value} agents={agents} />
        </Specimen>
        <Specimen
          name="A · Tab groups"
          note={`Mock UI. Up to ${capacity} panes per group in this frame (illustrative). New agent shows its destination; a full group overflows to a new group in the same checkout. Resizing flags, never regroups.`}
        >
          <TabGroupsCandidate key={count.value} agents={agents} capacity={capacity} />
        </Specimen>
        <Specimen
          name="B · Stacked regions"
          note="Mock UI. Two fixed regions; each picker keeps hidden agents and their state. Picking the other region's agent swaps them. Higher cost: needs its own view-binding design."
        >
          <RegionsCandidate key={count.value} agents={agents} />
        </Specimen>
      </div>
    </div>
  );
}
