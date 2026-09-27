import { CaretRight, Folder } from "@phosphor-icons/react";
import type { PaneAgent } from "../../lib/process-info";
import { DECK_DARK_ID, DECK_LIGHT_ID } from "../../settings/themes";
import type { RailCardPane, RailState, RailWorktreeGroup } from "../../ui/agent-rail-model";
import { CHROME_ICON, DeckIcon, FEATURE_ICON } from "../../ui/controls/deck-icon";
import { WorktreeCard } from "../../ui/worktree-card";
import { NOOP } from "../chrome-fixtures";
import { Column, Pair, ThemeScope } from "./before-after-2026-09-23-frame";

/**
 * Pair 2 of the attention group: how loud `asked` is on the card rail. Both
 * columns mount the shipped `WorktreeCard` over one fixture; the `after`
 * column differs only by the `ba23-att-rail--after` scope, which the
 * group's stylesheet keys every candidate rule on. The collapsed project
 * header is drawn with the rail's own `asr-cluster*` classes because the
 * header lives inside `AgentRail`, which the gallery cannot mount with a
 * chosen fold.
 */

const HOME = "/Users/deck";
const REPO = `${HOME}/spacevibe-deck`;
const WORKTREES = `${HOME}/deck-worktrees`;

function pane(fields: {
  readonly paneId: number;
  readonly agent: PaneAgent;
  readonly label: string;
  readonly state: RailState;
  readonly tabIndex: number;
  readonly focused?: boolean;
}): RailCardPane {
  return {
    kind: "agent",
    paneId: fields.paneId,
    agent: fields.agent,
    state: fields.state,
    confidence: "explicit",
    message: fields.label,
    age: "",
    changedAt: 0,
    focused: fields.focused ?? false,
    tabIndex: fields.tabIndex,
    model: "",
    label: fields.label,
  };
}

function checkout(fields: {
  readonly key: string;
  readonly branch: string;
  readonly name: string;
  readonly age: string;
  readonly primary?: boolean;
  readonly panes: readonly RailCardPane[];
}): RailWorktreeGroup {
  return {
    key: fields.key,
    branch: fields.branch,
    name: fields.name,
    path: fields.key,
    repositoryPath: REPO,
    primary: fields.primary ?? false,
    labelled: true,
    entries: fields.panes,
    panes: fields.panes,
    live: fields.panes.some((entry) => entry.state === "working"),
    age: fields.age,
    active: fields.panes.some((entry) => entry.focused),
    rows: [],
  };
}

const GROUPS: readonly RailWorktreeGroup[] = [
  checkout({
    key: REPO,
    branch: "main",
    name: "main",
    age: "now",
    primary: true,
    panes: [
      pane({ paneId: 201, agent: "claude", label: "Reading the rail model for the turn line", state: "working", tabIndex: 0, focused: true }),
      pane({ paneId: 202, agent: "codex", label: "Overwrite the migration or add a new one?", state: "asked", tabIndex: 1 }),
    ],
  }),
  checkout({
    key: `${WORKTREES}/fix-rail`,
    branch: "fix/rail",
    name: "fix-rail",
    age: "5m",
    panes: [
      pane({ paneId: 203, agent: "claude", label: "Build failed: tsc exit 2", state: "failed", tabIndex: 2 }),
      pane({ paneId: 204, agent: "opencode", label: "Both hosts read the same journal now", state: "done", tabIndex: 3 }),
    ],
  }),
];

/** A folded project: the header alone, the way `AgentRail` draws `data-collapsed`. */
function FoldedProject({ name, asking }: { readonly name: string; readonly asking: number }) {
  return (
    <div class="asr-cluster" data-labelled="true" data-collapsed="true">
      <div class="asr-cluster__head">
        <button
          type="button"
          class="asr-cluster__toggle"
          aria-expanded="false"
          aria-label={`Expand project ${name}${asking > 0 ? `, ${asking} need you` : ""}`}
        >
          <span class="asr-cluster__folder" aria-hidden="true">
            <DeckIcon icon={Folder} size={FEATURE_ICON} filled />
          </span>
          <span class="asr-cluster__name">{name}</span>
          {/* Candidate only: the stylesheet hides this outside the after scope. */}
          <span class="ba23-att-rail__fold-count" aria-hidden="true">
            {asking}
          </span>
          <span class="asr-cluster__caret" aria-hidden="true">
            <DeckIcon icon={CaretRight} size={CHROME_ICON} />
          </span>
        </button>
      </div>
    </div>
  );
}

function OpenProject({ name }: { readonly name: string }) {
  return (
    <div class="asr-cluster" data-labelled="true" data-collapsed="false">
      <div class="asr-cluster__head">
        <button type="button" class="asr-cluster__toggle" aria-expanded="true" aria-label={`Collapse project ${name}`}>
          <span class="asr-cluster__folder" aria-hidden="true">
            <DeckIcon icon={Folder} size={FEATURE_ICON} filled />
          </span>
          <span class="asr-cluster__name">{name}</span>
          <span class="asr-cluster__caret" aria-hidden="true">
            <DeckIcon icon={CaretRight} size={CHROME_ICON} />
          </span>
        </button>
      </div>
      {GROUPS.map((group) => (
        <WorktreeCard
          key={group.key}
          project={name}
          group={group}
          open
          onToggle={NOOP}
          onFocusPane={NOOP}
          onClosePane={NOOP}
          onCloseTab={NOOP}
          onSelectTab={NOOP}
        />
      ))}
    </div>
  );
}

function Rail({ after, tone }: { readonly after: boolean; readonly tone: "dark" | "light" }) {
  return (
    <ThemeScope themeId={tone === "dark" ? DECK_DARK_ID : DECK_LIGHT_ID}>
      <div class={`ba23-att-rail${after ? " ba23-att-rail--after" : ""}`} data-tone={tone}>
        <div class="asr-study">
          <div class="asr-study__stage">
            <nav class="asr-rail asr-rail--mounted" aria-label={`Agents, ${tone} (specimen)`}>
              <div class="asr-rail__list">
                <section class="asr-stream" aria-label="Open agents">
                  <OpenProject name="spacevibe-deck" />
                  <FoldedProject name="spacevibe-api" asking={2} />
                </section>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </ThemeScope>
  );
}

export function NeedsMeRailPair() {
  return (
    <Pair>
      <Column
        side="before"
        title="asked is the quietest state on the card"
        note="The shipped WorktreeCard. A working row gets a rim and three moving bars; the Codex row asking a question gets a still 5px dot at the far edge, and failed gets the same dot in red. The card head's dot only knows `live`, so it stays busy-coloured while an agent waits. The folded spacevibe-api hides two waiting agents with no trace. On light, measured against the rail: asked 4.35:1, done 2.96:1, and the row wash takes more off both."
      >
        <div class="ba23-att-rail__tones">
          <Rail after={false} tone="dark" />
          <Rail after={false} tone="light" />
        </div>
      </Column>
      <Column
        side="after"
        title="asked outranks working at a glance"
        note="Same component, same fixture. Asked rows get a yellow rim and wash, a 7px dot and DL-27.3's own ripple (1.8s, transform/opacity, still ring under reduced motion). Failed gets a static red rim. The card head dot takes the loudest state inside the card (failed > asked > working), and a folded project prints how many agents inside it need you. Light theme uses darker inks, measured against the rail: asked 6.9:1, failed 6.6:1, done 5.8:1. Changes would land in 04c-rail-worktree-card.css and agent-rail.tsx. DL fork: carries DL-27.3's halo onto card rows, amends DL-27.25's head mark to a roll-up, and adds a per-project count (DL-27.24/27.26; not the removed global Needs me line)."
      >
        <div class="ba23-att-rail__tones">
          <Rail after tone="dark" />
          <Rail after tone="light" />
        </div>
      </Column>
    </Pair>
  );
}
