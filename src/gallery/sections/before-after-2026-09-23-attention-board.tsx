import type { ComponentChildren } from "preact";
import { ArrowSquareOut, TerminalWindow } from "@phosphor-icons/react";
import type { PaneAgent } from "../../lib/process-info";
import { AgentBoardCard, formatRank, type BoardCardActions } from "../../ui/agent-board-card";
import type { BoardCard } from "../../ui/agent-board-model";
import type { RailState } from "../../ui/agent-rail-model";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import { RailStatusMark } from "../../ui/controls/rail-status-mark";
import { NOOP } from "../chrome-fixtures";
import { Column, Pair } from "./before-after-2026-09-23-frame";

/**
 * Pair 3 of the attention group: answering a permission prompt from the
 * Board. `before` is two real `AgentBoardCard`s. In `after` the Codex card is
 * still the real component, unchanged, and the Claude card is a drawing on
 * the card's own classes (`board-card*`) with one new block, because the
 * decision block is a surface the component does not have.
 */

const PROJECT = "spacevibe-deck";
const WORKTREES = "/Users/deck/deck-worktrees";
const COMMAND = "npm test -- src/terminal --reporter=verbose && npx tsc --noEmit -p .";

const ACTIONS: BoardCardActions = {
  onSelect: NOOP,
  onOpenInStage: NOOP,
  onStop: NOOP,
  onRestart: NOOP,
  onClose: NOOP,
};

function card(fields: {
  readonly paneId: number;
  readonly rank: number;
  readonly agent: PaneAgent;
  readonly name: string;
  readonly state: RailState;
  readonly checkout: string;
  readonly text: string;
  readonly changed: string;
}): BoardCard {
  return {
    paneId: fields.paneId,
    tabIndex: fields.rank - 1,
    ordinal: fields.rank,
    rank: fields.rank,
    agent: fields.agent,
    departed: false,
    hasRun: true,
    state: fields.state,
    name: fields.name,
    project: PROJECT,
    where: `${PROJECT} · ${fields.checkout}`,
    checkoutKey: `${WORKTREES}/${fields.checkout}`,
    checkout: fields.checkout,
    branch: fields.checkout,
    directory: `${WORKTREES}/${fields.checkout}`,
    what: { kind: "tail", text: fields.text },
    task: null,
    tail: fields.text,
    up: "12m",
    changed: fields.changed,
    confidence: "explicit",
    selected: false,
  };
}

const CLAUDE = card({
  paneId: 301,
  rank: 1,
  agent: "claude",
  name: "Claude",
  state: "asked",
  checkout: "fix-rail",
  text: `Do you want to run this command? ${COMMAND}`,
  changed: "42s",
});

const CODEX = card({
  paneId: 302,
  rank: 2,
  agent: "codex",
  name: "Codex",
  state: "asked",
  checkout: "main",
  text: "Allow command? cargo test -p deck-pty -- --nocapture",
  changed: "3m",
});

function Grid({ children }: { readonly children: ComponentChildren }) {
  return (
    <div class="agent-board ba23-att-board">
      <div class="agent-board__grid ba23-att-board__grid">{children}</div>
    </div>
  );
}

function RealCard({ value }: { readonly value: BoardCard }) {
  return <AgentBoardCard card={value} actions={ACTIONS} tabIndex={-1} onFocusRequest={NOOP} />;
}

/** The candidate: the Board card's own anatomy plus one decision block. */
function DecisionCard({ value }: { readonly value: BoardCard }) {
  return (
    <article class="board-card ba23-att-decide" data-state="asked" data-pane-id={value.paneId}>
      <button
        type="button"
        class="board-card__hit"
        tabIndex={-1}
        aria-label={`${value.name}, asked, ${value.where}`}
      />
      <div class="board-card__status">
        <RailStatusMark state="asked" confidence="explicit" />
        <span class="board-label board-card__state">asked</span>
      </div>
      <span class="board-card__checkout" title={value.where}>
        {value.project}
      </span>
      <span class="board-card__num">{formatRank(value.rank)}</span>
      <div class="board-card__id">
        <AgentGlyph agent={value.agent} className="board-card__glyph" />
        <span class="board-card__where" title={value.where}>
          {value.name} · {value.checkout}
        </span>
      </div>
      <div class="ba23-att-ask">
        <div class="ba23-att-ask__line">
          <span class="ba23-att-ask__tool" title="Bash command" aria-label="Bash command">
            <DeckIcon icon={TerminalWindow} size={ROW_ICON} />
          </span>
          <code class="ba23-att-ask__command">{COMMAND}</code>
        </div>
        <div class="ba23-att-ask__buttons">
          <button type="button" class="cfg-btn ba23-att-ask__allow" aria-keyshortcuts="A">
            Allow <kbd>A</kbd>
          </button>
          <button type="button" class="cfg-btn" aria-keyshortcuts="D">
            Deny <kbd>D</kbd>
          </button>
          <button
            type="button"
            class="iconbtn ba23-att-ask__open"
            aria-label="Open Claude's pane"
            title="Open pane"
          >
            <DeckIcon icon={ArrowSquareOut} size={ROW_ICON} />
          </button>
        </div>
      </div>
      {/* Time left before the hook gives up and the terminal prompt takes over. */}
      <div
        class="ba23-att-ask__timer"
        role="progressbar"
        aria-label="Time left to answer here"
        aria-valuemin={0}
        aria-valuemax={600}
        aria-valuenow={558}
        title="Answer here within 10 minutes, then the terminal prompt takes over"
      >
        <span style={{ transform: "scaleX(0.93)" }} />
      </div>
    </article>
  );
}

export function BoardDecisionPair() {
  return (
    <Pair>
      <Column
        side="before"
        title="the question is two clipped lines, and the only answer is Open"
        note="Two real AgentBoardCards in asked. The card quotes the agent's last output, clamped to two lines, so a long command loses its tail, which is the part that matters. A press opens the pane (DECK-43); answering means leaving the Board, reading the terminal prompt and pressing its key."
      >
        <Grid>
          <RealCard value={CLAUDE} />
          <RealCard value={CODEX} />
        </Grid>
      </Column>
      <Column
        side="after"
        title="Claude asks on the card; you answer on the card"
        note="Drawn on the card's own classes. No label or footer: a terminal icon (tooltip: Bash) marks the command, which wraps whole; Allow / Deny answer it, their A / D keys showing only on hover or focus; Open is an icon. A thin bar under the card runs down the hook's 600s default, after which the terminal prompt answers again. The exact decision output for that event still has to be verified. Codex has no confirmed equivalent, so its card (real component, right) keeps today's behaviour. Partly reverses DECK-43 (2026-09-09), which removed the Board's reply composer; installing the hook edits the user's Claude settings and needs consent copy."
      >
        <Grid>
          <DecisionCard value={CLAUDE} />
          <RealCard value={CODEX} />
        </Grid>
      </Column>
    </Pair>
  );
}
