import { useLayoutEffect, useRef } from "preact/hooks";
import { render, type ComponentChildren } from "preact";
import type { PaneAgent } from "../../lib/process-info";
import { PaneAgentHeader } from "../../terminal/pane-agent-header";
import type { PaneView } from "../../terminal/tabs-store";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import type { RailCardPane, RailState, RailWorktreeGroup } from "../../ui/agent-rail-model";
import { WorktreeCard } from "../../ui/worktree-card";
import { NOOP } from "../chrome-fixtures";
import { Specimen } from "../specimen";
import { Column, Pair } from "./before-after-2026-09-23-frame";
import { ChangesDock, DiffStat } from "./before-after-2026-09-23-review-changes";
import "./before-after-2026-09-23-review.css";

/**
 * The REVIEW group of the 2026-09-23 pairs: finishing an agent's work.
 *
 * Every `before` is the shipped `WorktreeCard` and `PaneAgentHeader` over a
 * fixture. The `after` columns keep those same components and add the
 * candidate beside or into them — the diff stat is written into the real
 * card's meta line after mount, the rename field replaces the real row's
 * name the same way — so only the candidate is drawn, never the chrome
 * around it. The fixtures are static, so nothing re-renders over those
 * additions.
 */

const PROJECT = "spacevibe-deck";
const CHECKOUT_KEY = "/Users/deck/deck-worktrees/api-client";
const REPO_ROOT = "/Users/deck/spacevibe-deck";

function railPane(fields: {
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
    message: "",
    age: "",
    changedAt: 0,
    focused: fields.focused ?? false,
    tabIndex: fields.tabIndex,
    model: "",
    label: fields.label,
  };
}

function apiCheckout(panes: readonly RailCardPane[]): RailWorktreeGroup {
  return {
    key: CHECKOUT_KEY,
    branch: "feat/api-client",
    name: "api-client",
    path: CHECKOUT_KEY,
    repositoryPath: REPO_ROOT,
    primary: false,
    labelled: true,
    entries: panes,
    panes,
    live: panes.some((entry) => entry.state === "working"),
    age: "4m",
    active: panes.some((entry) => entry.focused),
    rows: [],
  };
}

/** A pane as the tab layer lists it — only what the header reads. */
function paneView(paneId: number, agent: PaneAgent): PaneView {
  return {
    paneId,
    agent,
    attention: "none",
    phase: "idle",
    hasRun: true,
    changedAt: 0,
    sessionId: null,
    startedAt: 0,
  };
}

const HEADER_INPUT = { send: async () => true, focus: NOOP };

/**
 * The real card inside the rail's own cluster classes, at rail width.
 * `decorate` runs once after mount against the card's DOM — how a candidate
 * lands inside shipped markup without a component change.
 */
function RailCard({
  group,
  decorate,
}: {
  readonly group: RailWorktreeGroup;
  readonly decorate?: (card: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  /* oxlint-disable react-hooks/exhaustive-deps -- mount-once: callers pass inline `decorate`, and re-running it would decorate the card twice */
  useLayoutEffect(() => {
    const card = ref.current?.querySelector<HTMLElement>(".asr-card");
    if (card && decorate) decorate(card);
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */
  return (
    <div ref={ref} class="asr-study ba23-review__rail">
      <div class="asr-study__stage">
        <nav class="asr-rail asr-rail--mounted" aria-label="Agents (before/after specimen)">
          <div class="asr-rail__list">
            <section class="asr-stream" aria-label="Open agents">
              <div class="asr-cluster">
                <WorktreeCard
                  project={PROJECT}
                  group={group}
                  open
                  onToggle={NOOP}
                  onFocusPane={NOOP}
                  onClosePane={NOOP}
                  onCloseTab={NOOP}
                  onSelectTab={NOOP}
                />
              </div>
            </section>
          </div>
        </nav>
      </div>
    </div>
  );
}

/** Mounts a Preact subtree at the end of the first element `selector` finds. */
function mountInto(root: HTMLElement, selector: string, node: ComponentChildren): void {
  const target = root.querySelector<HTMLElement>(selector);
  if (target === null) return;
  const host = document.createElement("span");
  host.className = "ba23-review__inject";
  target.append(host);
  render(<>{node}</>, host);
}

/** A pane card: the shipped header in the shipped bar, then terminal text. */
function MiniPane({
  header,
  lines,
}: {
  readonly header: ComponentChildren;
  readonly lines: readonly string[];
}) {
  return (
    <div class="pane pane--agent-header ba23-review__pane">
      <div class="pane__bar">
        <div class="pane-agent-header-host">{header}</div>
      </div>
      <pre class="ba23-review__term">
        {lines.map((line, index) => (
          <div
            key={index}
            data-tone={line.startsWith("⏺") ? "lead" : line.startsWith(">") ? "prompt" : undefined}
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------ 1 · Changes panel */

const CHANGES_PANES = [
  railPane({
    paneId: 21,
    agent: "claude",
    label: "Claude",
    state: "done",
    tabIndex: 0,
    focused: true,
  }),
  railPane({ paneId: 22, agent: "codex", label: "Codex", state: "working", tabIndex: 1 }),
];
const CLAUDE_DONE_MESSAGE = "Refactored the API client; retries now live in fetch-retry.ts.";
const CLAUDE_DONE_LINES = [
  "⏺ Refactored the API client.",
  "  • Moved the retry loop into fetch-retry.ts",
  "  • Added api-client.test.ts (contract tests)",
  "  • Deleted legacy-client.ts, updated its two callers",
  "",
  "⏺ All 214 tests pass. 6 files changed.",
  "",
  "> ",
];

function ChangesWindow({ after }: { readonly after: boolean }) {
  return (
    <div class="ba23-review__window">
      <RailCard
        group={apiCheckout(CHANGES_PANES)}
        decorate={
          after ? (card) => mountInto(card, ".asr-card__meta", <DiffStat interactive />) : undefined
        }
      />
      <div class="ba23-review__stage">
        <MiniPane
          header={
            <PaneAgentHeader
              pane={paneView(21, "claude")}
              message={CLAUDE_DONE_MESSAGE}
              input={HEADER_INPUT}
            />
          }
          lines={CLAUDE_DONE_LINES}
        />
      </div>
      {after && <ChangesDock />}
    </div>
  );
}

function changesPair() {
  return (
    <Pair>
      <Column
        side="before"
        wide
        title="ships · the agent says it changed 6 files; Deck cannot show them"
        note="The card knows the branch and the age; the pane header repeats the agent's last sentence. Nothing in Deck runs git status (docs/internals/agent-rail.md: 'No git status is run anywhere'), so reviewing the work means leaving for VS Code, GitHub Desktop or git diff in another pane — then copying whatever you want fixed back into the prompt by hand."
      >
        <ChangesWindow after={false} />
      </Column>
      <Column
        side="after"
        wide
        title="candidate · +/− on the card opens a Changes dock tab; a line comment goes to the agent"
        note="Card, pane header and dock tabs are real; the Changes body is drawn. Status is a dot, the file count and meaning live in tooltips, ⌘↵ shows on focus. Electron only (new git IPC, R6). Open: git cost on large repos, whether 'no git status' was deliberate, DL-3.2 green/red roles."
      >
        <ChangesWindow after />
      </Column>
    </Pair>
  );
}

/* ----------------------------------------------------- 2 · Inline rename */

const RENAME_PANE_ID = 32;
const RENAME_BEFORE = [
  railPane({ paneId: 31, agent: "claude", label: "Claude", state: "working", tabIndex: 0 }),
  railPane({
    paneId: RENAME_PANE_ID,
    agent: "claude",
    label: "Claude 2",
    state: "done",
    tabIndex: 1,
    focused: true,
  }),
  railPane({ paneId: 33, agent: "codex", label: "Codex", state: "working", tabIndex: 2 }),
];
const RENAME_AFTER = [
  railPane({
    paneId: 31,
    agent: "claude",
    label: "Flaky test hunt",
    state: "working",
    tabIndex: 0,
  }),
  railPane({
    paneId: RENAME_PANE_ID,
    agent: "claude",
    label: "API client refactor",
    state: "done",
    tabIndex: 1,
    focused: true,
  }),
  railPane({ paneId: 33, agent: "codex", label: "Codex", state: "working", tabIndex: 2 }),
];
const RENAME_MESSAGE = "Refactored the API client; retries now live in fetch-retry.ts.";

/** The row's name swapped for a field, the way the candidate edits in place. */
function editName(card: HTMLElement): void {
  const row = card.querySelector<HTMLElement>(`.asr-card__row[data-pane-id="${RENAME_PANE_ID}"]`);
  if (row === null) return;
  row.dataset.renaming = "true";
  mountInto(
    row,
    ".asr-card__name",
    <input
      class="ba23-rename__field"
      aria-label="Agent name — Enter saves, Escape cancels"
      title="Enter saves · Esc cancels"
      placeholder="Claude 2"
      value="API client refactor"
      spellcheck={false}
    />,
  );
}

/** The candidate header: the name alone; the last sentence moves to the tooltip. */
function NamedHeader() {
  return (
    <div class="pane-agent-header ba23-rename__header">
      <span class="pane-agent-header__identity" title="claude">
        <AgentGlyph agent="claude" className="pane-agent-header__logo" />
      </span>
      <span class="ba23-rename__title" title={`${RENAME_MESSAGE}\nDouble-click to rename`}>
        API client refactor
      </span>
    </div>
  );
}

function renamePair() {
  return (
    <Pair>
      <Column
        side="before"
        title="ships · two Claudes, told apart by a number"
        note="Rows are named by agent and open order: Claude, Claude 2. No control sets a name — SessionTab.name is only written by presets, restore and pane moves — so the pane header falls back to the last sentence and the rail row to the ordinal."
      >
        <div class="ba23-rename__stack">
          <RailCard group={apiCheckout(RENAME_BEFORE)} />
          <MiniPane
            header={
              <PaneAgentHeader
                pane={paneView(RENAME_PANE_ID, "claude")}
                message={RENAME_MESSAGE}
                input={HEADER_INPUT}
              />
            }
            lines={["> "]}
          />
        </div>
      </Column>
      <Column
        side="after"
        title="candidate · double-click to name it"
        note="Top: editing in place (Enter saves, Esc cancels, empty falls back). Below: saved — row and pane header show the name alone; the last sentence moves to the tooltip. Journaled via SessionTab.name. Renderer only."
      >
        <div class="ba23-rename__stack">
          <RailCard group={apiCheckout(RENAME_BEFORE)} decorate={editName} />
          <RailCard group={apiCheckout(RENAME_AFTER)} />
          <MiniPane header={<NamedHeader />} lines={["> "]} />
        </div>
      </Column>
    </Pair>
  );
}

export function ReviewPairs() {
  return (
    <>
      <Specimen
        name="8 · Changes panel"
        note="Wave 2. The largest gap in the review: 14 of the surveyed tools let you read an agent's diff and send line comments back to it; Deck shows neither."
        surface="none"
      >
        {changesPair()}
      </Specimen>
      <Specimen
        name="9 · Name an agent"
        note="Wave 1. Two agents of the same kind in one checkout are told apart only by an ordinal."
        surface="none"
      >
        {renamePair()}
      </Specimen>
    </>
  );
}
