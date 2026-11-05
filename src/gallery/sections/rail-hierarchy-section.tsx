import { useState } from "preact/hooks";
import { AgentStateMark } from "../../ui/blocks/agent-state-mark";
import { Button } from "../../ui/controls/button";
import { ProjectRailHeader } from "../../ui/project-rail/project-rail-header";
import type { RowCommands } from "../../ui/project-rail/project-rail-commands";
import type { ProjectCommands } from "../../ui/project-rail/project-rail-project-commands";
import { ProjectRailRow } from "../../ui/project-rail/project-rail-row";
import { WORKDAY } from "../../ui/rail-view-fixtures";
import {
  railItems,
  type RailGroup,
  type RailItem,
  type RailStatus,
} from "../../ui/rail-view-model";
import { SectionHead, Specimen } from "../specimen";
import { AfterWorkspace, type NoGitMeta } from "./rail-hierarchy-after";
import { MOCK_WORKSPACES, type MockAgent, type MockWorkspace } from "./rail-hierarchy-data";
import { HierarchyMark } from "./rail-hierarchy-marks";
import { ThemePair } from "./recipe-states-kit";
import "./rail-hierarchy-section.css";

/**
 * Rail hierarchy and status marks: the mock (ledger `2026-11-06-rail-hierarchy-status-marks-
 * decisions.md`, RH-17, RH-18). Left, the rail as shipped, drawn by the real header and row;
 * right, the proposal, from the same tokens and parts, on the same worst-case data. Graphite
 * above, Deck Light below.
 */

const NOOP = (): void => {};
const ROW_COMMANDS: RowCommands = {
  archive: NOOP,
  archived: false,
  close: NOOP,
  copyPath: NOOP,
  openFolderLabel: "Open in Finder",
  checkoutActions: [],
};
const PROJECT_COMMANDS: ProjectCommands = {
  newAgent: NOOP,
  canMoveUp: false,
  canMoveDown: false,
  moveUp: NOOP,
  moveDown: NOOP,
  hide: NOOP,
};

const BASE = railItems(WORKDAY).find((item) => item.entry.kind === "agent") as RailItem;
const MINUTE = 60_000;
const UNIT_MS: Readonly<Record<string, number>> = {
  m: MINUTE,
  h: 60 * MINUTE,
  d: 24 * 60 * MINUTE,
};

/** The mock's literal age ("4m", "1h", "now") as a `changedAt` the real row formats back. */
function changedAt(age: string): number {
  const unit = UNIT_MS[age.slice(-1)];
  return Date.now() - (unit === undefined ? 0 : Number.parseInt(age, 10) * unit);
}

function realItem(workspace: MockWorkspace, agent: MockAgent, index: number): RailItem {
  const entry =
    BASE.entry.kind === "agent"
      ? { ...BASE.entry, agent: agent.agent, focused: agent.focused === true }
      : BASE.entry;
  return {
    ...BASE,
    // A folder git does not know: the real row falls back to the folder icon and name.
    checkout: workspace.git === false ? { ...BASE.checkout, labelled: false } : BASE.checkout,
    id: `pane:${workspace.key}-${index}`,
    projectKey: workspace.key,
    project: workspace.name,
    branch: agent.branch,
    title: agent.title,
    status: agent.status,
    changedAt: changedAt(agent.age),
    entry,
  };
}

function realGroup(workspace: MockWorkspace): RailGroup {
  const items = workspace.agents.map((agent, index) => realItem(workspace, agent, index));
  return { key: workspace.key, label: workspace.name, items, count: items.length };
}

function BeforeWorkspace({ workspace }: { readonly workspace: MockWorkspace }) {
  const group = realGroup(workspace);
  return (
    <section
      aria-label={workspace.name}
      className="mb-(--space-group-sm) flex flex-col gap-(--space-list)"
    >
      <ProjectRailHeader
        group={group}
        markPath={null}
        folded={workspace.folded}
        commands={PROJECT_COMMANDS}
        active={false}
        onToggle={NOOP}
      />
      {workspace.folded
        ? null
        : group.items.map((item, index) => (
            <ProjectRailRow
              key={item.id}
              item={item}
              tabStop={index === 0}
              pinned={false}
              commands={ROW_COMMANDS}
              onSelect={NOOP}
            />
          ))}
      {!workspace.folded && group.items.length === 0 ? (
        <p className="flex h-(--row-24) items-center px-(--space-pad-row) text-xs text-(--text-faint)">
          No sessions
        </p>
      ) : null}
    </section>
  );
}

const MARKS: readonly RailStatus[] = [
  "needs-input",
  "unread",
  "working",
  "failed",
  "done",
  "ended",
  "idle",
];

/** Both marks at the size the rail draws them and magnified, so the shapes can be judged. */
function MarkSheet() {
  return (
    <div className="rh-marks ui-preset">
      {(["before", "after"] as const).map((which) => (
        <div key={which} className="rh-marks__row">
          <span className="rh-marks__label">{which}</span>
          {MARKS.map((status) => (
            <span key={status} className="rh-marks__cell">
              <span className="rh-marks__pair">
                {which === "before" ? (
                  <AgentStateMark status={status} />
                ) : (
                  <HierarchyMark status={status} />
                )}
                <span className="rh-marks__zoom">
                  {which === "before" ? (
                    <AgentStateMark status={status} />
                  ) : (
                    <HierarchyMark status={status} />
                  )}
                </span>
              </span>
              <span className="rh-marks__name">{status}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

const NO_GIT_OPTIONS: readonly { readonly value: NoGitMeta; readonly label: string }[] = [
  { value: "label", label: 'No git: "no git"' },
  { value: "folder-only", label: 'No git: "folder only"' },
  { value: "folder", label: "No git: folder name" },
  { value: "agent", label: "No git: agent name" },
  { value: "none", label: "No git: date only" },
];

export function RailHierarchySection() {
  // The owner chose icons off (2026-11-06): the proposal opens without them; the button shows the
  // other side.
  const [marks, setMarks] = useState(false);
  // What a non-git workspace's meta line reads (the owner's open question, 2026-11-06).
  const [noGit, setNoGit] = useState<NoGitMeta>("folder-only");
  return (
    <>
      <SectionHead
        title="rail · hierarchy and status marks"
        blurb="Mock for the RH ledger. Left: the rail as it ships. Right: the proposal on the same data. Scroll both lists: the right header sticks."
      />
      <Specimen
        name="rail"
        note="9 workspaces, 34 agents, all 7 statuses; row 44→32, agent text 13→11, logo box 28→20, mark slot 14→12"
      >
        <div className="rh-toggle ui-preset">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={marks}
            onClick={() => setMarks((on) => !on)}
          >
            Status icons: {marks ? "on" : "off"}
          </Button>
          <span className="rh-toggle__group" role="group" aria-label="No-git meta line">
            {NO_GIT_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                size="sm"
                aria-pressed={noGit === option.value}
                onClick={() => setNoGit(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </span>
          <span className="rh-toggle__note">
            Off hides every status icon in the proposal (rows and the folded header's circles); the
            title weight, tint, branch colour and shimmer stay.
          </span>
        </div>
        <ThemePair ground="--sidebar-bg">
          <div className="rh-compare ui-preset" data-marks={marks ? "on" : "off"}>
            <div className="rh-column">
              <span className="rh-column__title">before (real components)</span>
              <div className="rh-frame">
                {MOCK_WORKSPACES.map((workspace) => (
                  <BeforeWorkspace key={workspace.key} workspace={workspace} />
                ))}
              </div>
            </div>
            <div className="rh-column">
              <span className="rh-column__title">after (proposal)</span>
              <div className="rh-frame">
                {MOCK_WORKSPACES.map((workspace) => (
                  <AfterWorkspace key={workspace.key} workspace={workspace} noGit={noGit} />
                ))}
              </div>
            </div>
          </div>
        </ThemePair>
      </Specimen>
      <Specimen
        name="state marks"
        note="RH-3: seven shapes, no hollow ring; 12 slot / 8 glyph, then 4x"
      >
        <ThemePair ground="--sidebar-bg">
          <MarkSheet />
        </ThemePair>
      </Specimen>
    </>
  );
}
