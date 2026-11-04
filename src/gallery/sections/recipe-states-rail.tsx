import type { RememberedPane } from "../../lib/session-schema";
import { AgentStateMark } from "../../ui/blocks/agent-state-mark";
import { Chip } from "../../ui/blocks/chip";
import type { RowCommands } from "../../ui/project-rail/project-rail-commands";
import { ProjectRailRow } from "../../ui/project-rail/project-rail-row";
import { RememberedRailRow } from "../../ui/project-rail/remembered-row";
import { WORKDAY } from "../../ui/rail-view-fixtures";
import { railItems, type RailItem, type RailStatus } from "../../ui/rail-view-model";
import { SectionHead, Specimen } from "../specimen";
import {
  isSelected,
  StateSheet,
  ThemePair,
  useForcedStates,
  type SheetRow,
} from "./recipe-states-kit";

/** The rail's sheet (RCP-15, RCP-18, RCP-19), from `ProjectRailRow` and its neighbours. */

const NOOP = (): void => {};

const COMMANDS: RowCommands = {
  archive: NOOP,
  archived: false,
  close: NOOP,
  copyPath: NOOP,
  openFolderLabel: "Open in Finder",
  checkoutActions: [],
};

const AGENT: RailItem = railItems(WORKDAY).find((item) => item.entry.kind === "agent") as RailItem;

/** The row in one state: selected is the focused pane; needs-you is its status. */
function agentRow(selected: boolean, status: RailStatus): RailItem {
  const entry = AGENT.entry.kind === "agent" ? { ...AGENT.entry, focused: selected } : AGENT.entry;
  // Against the live clock, which the rail's ages read, not the fixtures' fixed `NOW`.
  return { ...AGENT, entry, status, changedAt: Date.now() - 4 * 60_000 };
}

const REMEMBERED: RememberedPane = {
  id: "gallery-remembered",
  workspacePath: "/w/deck",
  cwd: "/w/deck",
  agent: "claude",
  launchCommand: null,
  title: "Score the migration plan",
  branch: "main",
  sessionId: null,
  savedAt: Date.now() - 24 * 60 * 60_000,
} as RememberedPane;

const ROWS: readonly SheetRow[] = [
  {
    label: "agent row",
    draw: (state) =>
      state === "disabled" ? null : (
        <ProjectRailRow
          item={agentRow(isSelected(state), state === "needs you" ? "needs-input" : "working")}
          tabStop
          pinned={false}
          commands={COMMANDS}
          onSelect={NOOP}
        />
      ),
  },
  {
    label: "remembered",
    draw: (state) =>
      isSelected(state) || state === "disabled" || state === "needs you" ? null : (
        <RememberedRailRow
          row={{ pane: REMEMBERED, title: REMEMBERED.title ?? "", branch: "main" }}
          onResume={NOOP}
          onForget={NOOP}
        />
      ),
  },
  {
    label: "chip",
    draw: (state) =>
      isSelected(state) || state === "drag-over" ? null : (
        <Chip tone={state === "needs you" ? "need" : undefined} disabled={state === "disabled"}>
          3
        </Chip>
      ),
  },
];

const MARKS: readonly RailStatus[] = [
  "failed",
  "needs-input",
  "unread",
  "working",
  "done",
  "idle",
  "ended",
];

export function RecipeRailSection() {
  useForcedStates();
  return (
    <>
      <SectionHead
        title="rail · states"
        blurb="The project rail's real rows in every RCP-9 state, graphite beside Deck Light. Compare with the mock's rail tab (src/gallery/layout-mocks/ui-recipes/rail.html)."
      />
      <Specimen name="rows" note="44 rows, the mark in its 14 slot, actions on an opaque ground">
        <StateSheet rows={ROWS} ground="--sidebar-bg" columnWidth="minmax(15rem, 1fr)" />
      </Specimen>
      <Specimen
        name="state marks"
        note="RCP-15: a 9 dot, a 15 ring, a 7 square, the braille spinner"
      >
        <ThemePair ground="--sidebar-bg">
          <div class="flex flex-wrap items-center gap-4">
            {MARKS.map((status) => (
              <span key={status} class="flex items-center gap-1.5 text-xs text-(--text-faint)">
                <AgentStateMark status={status} />
                {status}
              </span>
            ))}
          </div>
        </ThemePair>
      </Specimen>
    </>
  );
}
