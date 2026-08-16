import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { ChevronRight } from "lucide-preact";
import { AGENT_LOGOS } from "../lib/agent-logos";
import type { PaneAgent } from "../lib/process-info";
import { DesktopChrome } from "../ui/app";
import { CHROME_ICON, DeckIcon } from "../ui/controls/deck-icon";
import { StatusBar } from "../ui/status-bar";
import {
  deckToolbarSpecimen,
  NOOP,
  repositoryScopedTabStripSpecimen,
} from "./chrome-fixtures";

/**
 * Gallery-only specimen for the navigation rail rebuilt around **a live agent**
 * rather than around a worktree.
 *
 * Settled already: a pinned `Needs you` block over everything else in recency
 * order, no mode switch, and state carried by one mark at the right edge with
 * no word beside it — the word survives in `title` and the aria-label so the
 * shape is the fast read and never the only read. `asked` is --yellow (the
 * attention tone the unread badge already uses, DL-3.2), `done` is --accent,
 * so "answer me" and "read my result" never share a colour. Status marks are
 * outside the icon system by intent (DL-14.6) and drawn in CSS; no file under
 * `src/` may hand-author vector markup (DL-14.1,
 * `scripts/icon-system.test.ts`).
 *
 * Open, and the reason three variants stand here: a Deck tab is a whole pane
 * layout, several panes can run agents, and two tabs can sit in one project.
 * P1 gives every agent pane its own row; P2 gives every tab one row with the
 * agents as marks inside it; P3 splits by question — the pinned block resolves
 * to the exact pane, the stream below stays one row per tab.
 *
 * Non-agent panes (a shell, a test runner) are deliberately absent from all
 * three: the rail answers "which agent", and a `vitest` row would be noise in
 * every variant.
 *
 * The measured behaviour behind the structure, from this machine's own
 * Claude/Codex corpus (2026-08-16): 2 projects touched per hour at the median,
 * 46 of 51 repositories having exactly one working directory, 83% of sessions
 * returning to a project already touched that day, and the project of a new
 * session sitting in the last five touched 88% of the time.
 */

type RowState = "asked" | "done" | "working" | "resting";

/**
 * The head of the newest turn in that pane — your prompt while it is still
 * unanswered, the agent's reply once it has answered. Which side said it is
 * not labelled: the sentence itself is the thing worth reading, and a `you:`
 * prefix on every second row was noise (2026-08-16).
 */
interface PaneMessage {
  readonly from: "you" | "agent";
  readonly text: string;
}

interface PaneRow {
  readonly id: string;
  readonly agent: PaneAgent;
  readonly state: RowState;
  readonly message: PaneMessage;
}

interface TabRow {
  readonly id: string;
  readonly project: string;
  /**
   * The worktree this tab sits in, absent when it is the repository's primary
   * checkout. 46 of 51 repositories in the measured corpus have exactly one
   * working directory, so this is the exception the row must survive, not the
   * spine it is built on.
   */
  readonly worktree?: string;
  readonly title: string;
  readonly age: string;
  readonly panes: readonly PaneRow[];
}

/**
 * Two tabs share `deck` on purpose: it is the case that separates the three
 * variants, since P1 renders two rows that read identically.
 */
const SEED_TABS: readonly TabRow[] = [
  {
    id: "deck-handoff",
    project: "deck",
    title: "api handoff",
    age: "2m",
    panes: [
      { id: "deck-handoff-claude", agent: "claude", state: "asked" , message: { from: "agent", text: "Ready to run the migration on 14 collections — apply it?" } },
      { id: "deck-handoff-codex", agent: "codex", state: "working" , message: { from: "you", text: "split the tab strip into two segments and keep the browser chip pinned right" } },
      { id: "deck-handoff-gemini", agent: "gemini", state: "resting" , message: { from: "agent", text: "Indexed 412 files, nothing to change." } },
    ],
  },
  {
    id: "deck-release",
    project: "deck",
    worktree: "release-hardening",
    title: "release watch",
    age: "3m",
    panes: [{ id: "deck-release-codex", agent: "codex", state: "working" , message: { from: "you", text: "watch the release workflow and report" } }],
  },
  {
    id: "bench-vote",
    project: "bench",
    worktree: "blind-vote-hardening",
    title: "vote fix",
    age: "5m",
    panes: [
      { id: "bench-vote-codex", agent: "codex", state: "done" , message: { from: "agent", text: "41 tests pass, 2 skipped, coverage 82%" } },
      { id: "bench-vote-claude", agent: "claude", state: "working" , message: { from: "you", text: "harden the blind vote path" } },
    ],
  },
  {
    id: "academy-migration",
    project: "academy",
    title: "payload migration",
    age: "12m",
    panes: [
      { id: "academy-codex", agent: "codex", state: "working" , message: { from: "you", text: "migrate the payload collections" } },
      { id: "academy-opencode", agent: "opencode", state: "working" , message: { from: "agent", text: "Rewriting the seed script now." } },
      { id: "academy-gemini", agent: "gemini", state: "resting" , message: { from: "agent", text: "No changes needed in this package." } },
      { id: "academy-claude", agent: "claude", state: "resting" , message: { from: "you", text: "review the migration diff" } },
    ],
  },
  {
    id: "api-token",
    project: "api",
    title: "token exchange",
    age: "1h",
    panes: [{ id: "api-codex", agent: "codex", state: "resting" , message: { from: "agent", text: "Token exchange looks correct." } }],
  },
  {
    id: "glow-logo",
    project: "glow-api",
    title: "logo pipeline",
    age: "3h",
    panes: [{ id: "glow-gemini", agent: "gemini", state: "resting" , message: { from: "agent", text: "Logo pipeline finished, 38 assets." } }],
  },
];

const STATE_LABEL: Readonly<Record<RowState, string>> = {
  asked: "needs you",
  done: "done",
  working: "working",
  resting: "resting",
};

/** Loudest state wins when a tab folds its panes into one row. */
const STATE_RANK: Readonly<Record<RowState, number>> = {
  asked: 3,
  done: 2,
  working: 1,
  resting: 0,
};

const NEEDS_YOU = (state: RowState): boolean =>
  state === "asked" || state === "done";

const tabState = (tab: TabRow): RowState =>
  tab.panes.reduce<RowState>(
    (loudest, pane) =>
      STATE_RANK[pane.state] > STATE_RANK[loudest] ? pane.state : loudest,
    "resting",
  );

/** Every agent pane that is asking or finished, with the tab it belongs to. */
const needyPanes = (
  tabs: readonly TabRow[],
): readonly { readonly tab: TabRow; readonly pane: PaneRow }[] =>
  tabs.flatMap((tab) =>
    tab.panes
      .filter((pane) => NEEDS_YOU(pane.state))
      .map((pane) => ({ tab, pane })),
  );

/** The agent marks a tab row shows before it starts counting. */
const CHIP_BUDGET = 3;

/** The pane a folded tab row speaks for: the one with the loudest state. */
const loudestPane = (tab: TabRow): PaneRow =>
  tab.panes.reduce((loudest, pane) =>
    STATE_RANK[pane.state] > STATE_RANK[loudest.state] ? pane : loudest,
  );

/**
 * The newest turn, trimmed by CSS rather than by slicing: the full sentence
 * stays in the DOM for the tooltip and for a screen reader, and only the
 * painted line is short.
 */
function MessageLine({ message }: { readonly message: PaneMessage }) {
  return <span class="asr-row__msg">{message.text}</span>;
}

function AgentLogo({
  agent,
  className,
}: {
  readonly agent: PaneAgent;
  readonly className: string;
}) {
  const logo = AGENT_LOGOS[agent];
  return logo === undefined ? null : (
    <img class={className} src={logo} alt="" />
  );
}

function StatusMark({ state }: { readonly state: RowState }) {
  return <span class="asr-row__mark" data-state={state} aria-hidden="true" />;
}

/** One agent inside an expanded tab: its own turn, its own state. */
function PaneDetailRow({
  pane,
  focused,
  onFocus,
}: {
  readonly pane: PaneRow;
  readonly focused: boolean;
  readonly onFocus: () => void;
}) {
  return (
    <button
      type="button"
      class="asr-pane"
      data-state={pane.state}
      data-focused={focused}
      onClick={onFocus}
      aria-label={`${pane.agent}, ${STATE_LABEL[pane.state]}`}
      title={`${pane.agent} — ${STATE_LABEL[pane.state]}\n${pane.message.text}`}
    >
      <AgentLogo agent={pane.agent} className="asr-pane__logo" />
      <strong class="asr-pane__agent">{pane.agent}</strong>
      <StatusMark state={pane.state} />
      <span class="asr-pane__msg">{pane.message.text}</span>
    </button>
  );
}

/**
 * The rail's one row shape: a tab, its agents as marks inside it, and — when
 * it runs more than one agent — a disclosure that unfolds those agents into
 * rows of their own. The disclosure is a sibling of the row, not a child: a
 * control nested inside a button is not operable.
 */
function TabItem({
  tab,
  open,
  onToggle,
  onFocusPane,
  focusedPaneId,
}: {
  readonly tab: TabRow;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Focus the pane that agent runs in — a chip and a pane row do the same. */
  readonly onFocusPane: (paneId: string) => void;
  readonly focusedPaneId: string | null;
}) {
  const state = tabState(tab);
  const shown = tab.panes.slice(0, CHIP_BUDGET);
  const overflow = tab.panes.length - shown.length;
  // A folded row speaks for one pane — the loudest — so the line under it is
  // that pane's newest turn rather than a summary of several conversations.
  const voice = loudestPane(tab);
  const expandable = tab.panes.length > 1;
  const where =
    tab.worktree === undefined
      ? tab.project
      : `${tab.project} · ${tab.worktree}`;

  return (
    <div class="asr-item" data-open={open}>
      {expandable ? (
        <button
          type="button"
          class="asr-disclose"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the ${tab.panes.length} agents in ${where}`}
          onClick={onToggle}
        >
          <DeckIcon icon={ChevronRight} size={CHROME_ICON} />
        </button>
      ) : (
        <span class="asr-disclose asr-disclose--empty" aria-hidden="true" />
      )}

      {/*
        The row is a container, not a button: an agent chip inside it has to be
        its own control, and a button nested in a button is not operable. The
        hit layer below takes every click the chips do not (spec §2.2).
      */}
      <div class="asr-row asr-row--tab" data-state={state}>
        <button
          type="button"
          class="asr-row__hit"
          aria-label={`${where}, tab ${tab.title}, ${tab.panes.length} agents, ${STATE_LABEL[state]}, ${tab.age}`}
          title={`${where} · ${tab.title} — ${STATE_LABEL[state]}\n${voice.message.text}`}
        />
        <span class="asr-row__name">
          <strong>{tab.project}</strong>
          {/* A worktree is named only when the tab is not in the primary
              checkout — otherwise every row would carry a word that says
              nothing about it. */}
          {tab.worktree !== undefined && (
            <span class="asr-row__worktree">{tab.worktree}</span>
          )}
        </span>
        <span class="asr-chips">
          {shown.map((pane) => (
            <button
              key={pane.id}
              type="button"
              class="asr-chip"
              data-state={pane.state}
              aria-label={`Focus ${pane.agent} in ${where}`}
              title={`${pane.agent} — ${STATE_LABEL[pane.state]}\n${pane.message.text}`}
              onClick={() => {
                onFocusPane(pane.id);
              }}
            >
              <AgentLogo agent={pane.agent} className="asr-chip__logo" />
            </button>
          ))}
          {/* `+N` is the disclosure's second face: it says "there is more in
              here", so pressing it opens the same list. */}
          {overflow > 0 && (
            <button
              type="button"
              class="asr-chip asr-chip--more"
              aria-label={`Show all ${tab.panes.length} agents in ${where}`}
              onClick={onToggle}
            >
              +{overflow}
            </button>
          )}
        </span>
        <span class="asr-row__age">{tab.age}</span>
        <StatusMark state={state} />
        {/* Expanded, the per-agent rows carry the turns, so the folded line
            would only repeat one of them. */}
        {!open && <MessageLine message={voice.message} />}
      </div>

      {open && (
        <div class="asr-panes">
          {tab.panes.map((pane) => (
            <PaneDetailRow
              key={pane.id}
              pane={pane}
              focused={pane.id === focusedPaneId}
              onFocus={() => {
                onFocusPane(pane.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function PinnedBlock({
  count,
  children,
}: {
  readonly count: number;
  readonly children: ComponentChildren;
}) {
  return (
    <section class="asr-block" aria-label="Agents needing you">
      {/* A group label NAMES something, so it is sentence-case; the state
          values behind each mark stay lowercase (DL-4.4, fork 2026-08-15). */}
      <header class="asr-block__head">
        <span>Needs you</span>
        <span class="asr-block__count">{count}</span>
      </header>
      {children}
    </section>
  );
}

function AgentStatusRail({
  tabs,
  mounted = false,
  onFocusPane,
}: {
  readonly tabs: readonly TabRow[];
  /** Inside the window shell the rail drops its own frame and fills the side. */
  readonly mounted?: boolean;
  /** Told which pane the rail just sent focus to, so the stage can ring it. */
  readonly onFocusPane?: (paneId: string) => void;
}) {
  const needyCount = needyPanes(tabs).length;
  const needyTabs = tabs.filter((tab) => NEEDS_YOU(tabState(tab)));
  const quietTabs = tabs.filter((tab) => !NEEDS_YOU(tabState(tab)));
  // Which tabs are unfolded. A new Set each time rather than a mutated one
  // (C1), so the signal actually notifies.
  const openIds = useSignal<ReadonlySet<string>>(new Set());
  const toggle = (id: string): void => {
    const next = new Set(openIds.value);
    if (!next.delete(id)) next.add(id);
    openIds.value = next;
  };
  // Which pane the rail last sent focus to. In the app this is `TabManager`'s
  // own focus; here it stands in for it so the click has a visible answer.
  const focusedPaneId = useSignal<string | null>(null);
  const item = (tab: TabRow) => (
    <TabItem
      key={tab.id}
      tab={tab}
      open={openIds.value.has(tab.id)}
      onToggle={() => {
        toggle(tab.id);
      }}
      focusedPaneId={focusedPaneId.value}
      onFocusPane={(paneId) => {
        focusedPaneId.value = paneId;
        onFocusPane?.(paneId);
        // Focusing from a folded row also reveals where focus went.
        if (!openIds.value.has(tab.id)) {
          toggle(tab.id);
        }
      }}
    />
  );

  return (
    <div class={mounted ? "asr-rail asr-rail--mounted" : "asr-rail"}>
      {needyTabs.length > 0 && (
        <PinnedBlock count={needyCount}>
          {needyTabs.map(item)}
        </PinnedBlock>
      )}

      <section class="asr-stream" aria-label="Recent agents">
        {quietTabs.map(item)}
      </section>

      {/* Last row of the list, not a pinned footer — the shipped rail moved
          it inside on 2026-08-16 so it follows the final workspace. */}
      <button type="button" class="asr-open">
        Open workspace
      </button>
    </div>
  );
}

/** Immutably promote the first working pane into the pinned block. */
function promoteOne(tabs: readonly TabRow[]): readonly TabRow[] {
  const target = tabs
    .flatMap((tab) => tab.panes.map((pane) => ({ tab, pane })))
    .find(({ pane }) => pane.state === "working");
  return target === undefined
    ? tabs
    : tabs.map((tab) =>
        tab.id !== target.tab.id
          ? tab
          : {
              ...tab,
              age: "now",
              panes: tab.panes.map((pane) =>
                pane.id === target.pane.id ? { ...pane, state: "asked" } : pane,
              ),
            },
      );
}

/** Immutably clear the pinned block, sending each pane back to the stream. */
function resolveAll(tabs: readonly TabRow[]): readonly TabRow[] {
  return tabs.map((tab) => ({
    ...tab,
    panes: tab.panes.map((pane) =>
      pane.state === "asked"
        ? { ...pane, state: "working" }
        : pane.state === "done"
          ? { ...pane, state: "resting" }
          : pane,
    ),
  }));
}

export function agentStatusRailSpecimen() {
  return <AgentStatusRailStudy />;
}

function AgentStatusRailStudy() {
  const tabs = useSignal<readonly TabRow[]>(SEED_TABS);
  const needsCount = needyPanes(tabs.value).length;
  return (
    <div class="asr-study">
      <div class="asr-study__bar">
        <span class="asr-study__state">
          {needsCount === 0
            ? "nothing is waiting on you"
            : `${needsCount} waiting on you`}
        </span>
        <span class="asr-study__actions">
          <button
            type="button"
            onClick={() => {
              tabs.value = promoteOne(tabs.value);
            }}
          >
            An agent just asked
          </button>
          <button
            type="button"
            onClick={() => {
              tabs.value = resolveAll(tabs.value);
            }}
          >
            Resolve all
          </button>
          <button
            type="button"
            onClick={() => {
              tabs.value = SEED_TABS;
            }}
          >
            Reset
          </button>
        </span>
      </div>
      <div class="asr-study__stage">
        <AgentStatusRail tabs={tabs.value} />
      </div>
    </div>
  );
}

/**
 * The same rail inside the real window shell, so the sidebar can be judged
 * against the frame, the stage and the status bar rather than on its own.
 * `DesktopChrome`, `TabStrip` and `StatusBar` here are the shipped components —
 * only the rail's data is seeded.
 */
export function agentStatusRailChromeSpecimen() {
  return <AgentStatusRailChrome />;
}

/** The three panes of the `deck · api handoff` tab, as the stage shows them. */
const STAGE_PANES = SEED_TABS[0].panes;

function AgentStatusRailChrome() {
  const focused = useSignal<string>(STAGE_PANES[0].id);
  // Bumped on every focus so re-picking the same pane restarts the ring —
  // an animation only replays when its element is new.
  const ping = useSignal(0);
  return (
    <DesktopChrome
      sidebar
      toolbar={deckToolbarSpecimen()}
      sidebarNavigation={
        <AgentStatusRail
          tabs={SEED_TABS}
          mounted
          onFocusPane={(paneId) => {
            focused.value = paneId;
            ping.value += 1;
          }}
        />
      }
      topTabs={null}
      stage={
        <main class="stage stage--strip">
          <div class="stage__strip" data-tauri-drag-region>
            {repositoryScopedTabStripSpecimen()}
          </div>
          <div class="stage__tabs">
            <div class="asr-stage" aria-label="Terminal panes">
              {STAGE_PANES.map((pane) => (
                <section
                  key={pane.id}
                  class="asr-stage__pane"
                  data-active={pane.id === focused.value}
                >
                  <header class="asr-stage__head">
                    <AgentLogo agent={pane.agent} className="asr-row__logo" />
                    <span>{pane.agent}</span>
                  </header>
                  <p class="asr-stage__line">{pane.message.text}</p>
                  {pane.id === focused.value && (
                    <span
                      key={`${pane.id}-${ping.value}`}
                      class="asr-stage__ring"
                      aria-hidden="true"
                    />
                  )}
                </section>
              ))}
            </div>
          </div>
        </main>
      }
      status={<StatusBar />}
      onMacTitlebarDoubleClick={NOOP}
    />
  );
}
