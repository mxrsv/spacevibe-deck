import type { PaneAgent } from "../../lib/process-info";
import { buildCardEntries, displayAgent } from "../../ui/agent-rail-card-model";
import type {
  RailCardEntry,
  RailCardPane,
  RailPaneRow,
  RailState,
  RailTabRow,
  RailWorktreeGroup,
} from "../../ui/agent-rail-model";
import type { NameVariant, SpaceNames } from "./space-names-data";

/**
 * Rail fixture for the space-name study. The Electron rail has no tab tier
 * (DL-27.23, 2026-08-26): a checkout card lists one row per agent PANE, and
 * `buildCardEntries` — the shipping function, called here — names each row.
 * That function is where a tab's `name` already reaches the rail: a named tab
 * gives every one of its panes the tab's name, ordinal-suffixed to stay unique
 * within the checkout (`auth`, `auth 2`), and the pane's own sentence gives
 * way to it.
 */

export const RAIL_PROJECT = "spacevibe-deck";

interface PaneFixture {
  readonly agent: PaneAgent;
  readonly state: RailState;
  readonly message: string;
  readonly focused?: boolean;
}

interface TabFixture {
  /** The `SpaceNames` key of this tab's space. */
  readonly key: number;
  readonly checkout: "main" | "worktree";
  readonly panes: readonly PaneFixture[];
}

/** Fixture spaces 1, 2, 3 in the primary checkout and 5 in the worktree. */
const TABS: readonly TabFixture[] = [
  {
    key: 1,
    checkout: "main",
    panes: [
      {
        agent: "claude",
        state: "working",
        message: "Reading the session journal for the saved name",
        focused: true,
      },
      { agent: "codex", state: "asked", message: "Keep the name on the tab or on the space?" },
    ],
  },
  {
    key: 2,
    checkout: "main",
    panes: [{ agent: "claude", state: "done", message: "Sorted the strip marks by folder" }],
  },
  {
    key: 3,
    checkout: "main",
    panes: [{ agent: "opencode", state: "done", message: "Drafted the hero copy for launch week" }],
  },
  {
    key: 5,
    checkout: "worktree",
    panes: [{ agent: "claude", state: "working", message: "Clipping the rail row at one pixel" }],
  },
];

const PRIMARY_PATH = "/work/spacevibe-deck";
const WORKTREE_PATH = "/work/wt/rail-overflow";

function paneRow(tab: TabFixture, pane: PaneFixture, at: number): RailPaneRow {
  return {
    paneId: tab.key * 10 + at,
    agent: pane.agent,
    state: pane.state,
    confidence: "explicit",
    message: pane.message,
    age: "",
    changedAt: 0,
    focused: pane.focused ?? false,
  };
}

function tabRow(tab: TabFixture, names: SpaceNames): RailTabRow {
  const name = names[tab.key] ?? null;
  const panes = tab.panes.map((pane, at) => paneRow(tab, pane, at));
  return {
    key: tab.key,
    index: tab.key,
    project: RAIL_PROJECT,
    identity: "",
    title: name ?? "",
    named: name !== null,
    message: "",
    age: "",
    changedAt: 0,
    openedAt: tab.key,
    state: "idle",
    panes,
    voice: null,
    active: panes.some((pane) => pane.focused),
    workspacePath: tab.checkout === "main" ? PRIMARY_PATH : WORKTREE_PATH,
  };
}

function checkout(
  primary: boolean,
  branch: string,
  name: string,
  path: string,
  entries: readonly RailCardEntry[],
): RailWorktreeGroup {
  const panes = entries.filter((entry): entry is RailCardPane => entry.kind === "agent");
  return {
    key: path,
    branch,
    name,
    path,
    repositoryPath: PRIMARY_PATH,
    primary,
    labelled: true,
    entries,
    panes,
    live: panes.some((pane) => pane.state === "working"),
    age: "",
    active: panes.some((pane) => pane.focused),
    rows: [],
  };
}

/** The two checkouts of the fixture, labelled by the shipping model. */
export function railGroups(names: SpaceNames): readonly RailWorktreeGroup[] {
  const rowsOf = (which: TabFixture["checkout"]): readonly RailTabRow[] =>
    TABS.filter((tab) => tab.checkout === which).map((tab) => tabRow(tab, names));
  return [
    checkout(
      true,
      "main",
      "spacevibe-deck",
      PRIMARY_PATH,
      buildCardEntries(rowsOf("main"), undefined),
    ),
    checkout(
      false,
      "fix/rail-overflow",
      "rail-overflow",
      WORKTREE_PATH,
      buildCardEntries(rowsOf("worktree"), undefined),
    ),
  ];
}

/** What one agent row says, split so each candidate can tone the parts. */
export interface RowText {
  readonly primary: string;
  /** Trailing context on the same line (B). */
  readonly context: string | null;
  /** A second line under the name (C). */
  readonly secondary: string | null;
}

/**
 * A named row is drawn three ways. A is the shipping label unchanged. B and C
 * differ from `identityOf`/`buildCardEntries`: B drops the ordinal for the
 * agent's name, C keeps the pane's sentence under the name. An unnamed row is
 * today's row in all three.
 */
export function rowText(variant: NameVariant, pane: RailCardPane, name: string | null): RowText {
  const said = pane.message.trim();
  if (name === null) return { primary: pane.label, context: null, secondary: null };
  if (variant === "A") return { primary: pane.label, context: null, secondary: null };
  if (variant === "B") {
    return { primary: name, context: displayAgent(pane.agent), secondary: null };
  }
  return { primary: name, context: null, secondary: said === "" ? null : said };
}

/** The `SpaceNames` key of the tab a pane row belongs to. */
export function tabKeyOf(pane: RailCardPane): number {
  return pane.tabIndex;
}

export const RAIL_CAPTIONS: Readonly<Record<NameVariant, string>> = {
  A: "Sidebar as the code draws it today once a name exists: buildCardEntries gives every pane of a named tab the tab's name, ordinal-suffixed (auth, auth 2), and the pane's sentence gives way to it. No change to the rail.",
  B: "Differs from shipping: the ordinal is replaced by the agent's name in a muted tone, so two panes of auth read auth · Claude and auth · Codex. The folder and branch stay on the cluster and card head, where DL-27.23 already prints them once.",
  C: "Differs from shipping: a named row keeps the pane's sentence on a second line under the name, so the name is the primary line and the ordinal is dropped. This amends DL-27.15's one-line row for named tabs only.",
};
