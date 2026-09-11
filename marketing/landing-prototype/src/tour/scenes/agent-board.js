/**
 * Panel 2 — the Agent Board (⌘⇧O).
 *
 * Deck 1.1's headline surface (`src/ui/agent-board.tsx`,
 * `docs/internals/agent-board.md`): one card per live agent pane, on the
 * stage, beside a rail that stays exactly as the user left it — the Board
 * toggles against nothing. It is a second projection over the same rail, so
 * this scene draws its rail AND its cards from one fixture: a pane cannot be
 * on the rail and missing from the Board, or say one thing in one and another
 * in the other.
 *
 * Since DECK-43 the grid is the whole Board — no filter column, no detail
 * panel — and pressing a card opens that agent's pane on the stage. The strip
 * above it carries the Board's own `Agents` chip, active.
 */

import { AGENT_MARKS } from "../../agent-strip.js";
import { renderStageStatusMark } from "../../appwin.js";
import { deepFreeze } from "../../product-stage.js";
import { frame, sceneAgentMark } from "./chrome.js";

const PRIMARY = { kind: "role", text: "Primary" };

/*
 * One fixture, two projections. Each pane carries what its rail row needs
 * (label, state) and what its card adds: `rank`, the ordinal the card prints;
 * `up` and `changed`, the footer's two ages; and a `task` where the pane was
 * launched with one — the card then leads with the task, not the sentence.
 *
 * The sentences are the hero's, so the Board reads as the same afternoon the
 * top of the page shows. Every `id` is null: a panel mounts no stream.
 */
const BOARD_PROJECTS = deepFreeze([
  {
    project: "spacevibe-deck",
    checkouts: [
      {
        name: "main",
        badge: PRIMARY,
        age: "now",
        open: true,
        panes: [
          {
            id: null,
            agent: "claude",
            label: "I'll trace why the pane divider drifts on resize.",
            state: "working",
            rank: 1,
            up: "12m",
            changed: "1m",
          },
          {
            id: null,
            agent: "codex",
            label: "96 passed · 0 failed",
            state: "done",
            rank: 2,
            up: "48m",
            changed: "2m",
          },
          {
            id: null,
            agent: "opencode",
            label: "typecheck clean · the branch follows cwd now",
            state: "done",
            rank: 3,
            up: "31m",
            changed: "2m",
          },
        ],
      },
      {
        name: "detach",
        badge: { kind: "branch", text: "feat/detach" },
        age: "5m",
        panes: [
          {
            id: null,
            agent: "codex",
            label: "npm test failed — 3 assertions in vote-panel.",
            state: "failed",
            rank: 4,
            up: "18m",
            changed: "5m",
          },
        ],
      },
    ],
  },
  {
    project: "spacevibe-api",
    checkouts: [
      {
        name: "main",
        badge: PRIMARY,
        age: "3h",
        panes: [
          {
            id: null,
            agent: "gemini",
            label: "Should I apply the pending migration?",
            state: "asked",
            rank: 5,
            up: "3h",
            changed: "3h",
          },
          {
            id: null,
            agent: "agy",
            label: "Batching the artifact uploads into one R2 write.",
            state: "working",
            rank: 6,
            up: "20m",
            changed: "1m",
            task: "Batch the artifact uploads into one R2 write",
          },
        ],
      },
    ],
  },
]);

/* The strip with the Board on the stage: its `Agents` chip is the active one. */
const BOARD_STRIP = deepFreeze([
  {
    kind: "terminal",
    agent: "claude",
    paneId: null,
    label: "I'll trace why the pane divider drifts on resize.",
    active: false,
  },
  { kind: "board", label: "Agents", active: true },
]);

/** Loudest first, the Board's own order; ties fall to the rank. */
const STATE_ORDER = { failed: 0, asked: 1, working: 2, done: 3, idle: 4, ended: 5 };

/** `displayAgent`: the catalog label's first word — `Claude Code` → `Claude`. */
function displayName(agent) {
  const entry = AGENT_MARKS.find((mark) => mark.id === agent);

  return entry === undefined ? agent : entry.label.split(" ")[0];
}

/** `whereOf`: project · checkout · branch, with a word already said dropped. */
function whereOf(project, checkout) {
  const branch = checkout.badge.kind === "branch" ? checkout.badge.text : null;
  const parts = [project, checkout.name, branch].filter((part) => part !== null);

  return parts.filter((part, index) => parts.indexOf(part) === index).join(" · ");
}

/** `formatRank`: two digits under ten. */
function formatRank(rank) {
  return rank < 10 ? `0${rank}` : String(rank);
}

/** Every pane on the rail, as a card, in the Board's order. */
function boardCards() {
  return BOARD_PROJECTS.flatMap((project) =>
    project.checkouts.flatMap((checkout) =>
      checkout.panes.map((pane) => ({ ...pane, where: whereOf(project.project, checkout) })),
    ),
  ).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.rank - b.rank);
}

/**
 * One card: status and rank, identity, what the agent said (or the task it
 * was given), and the footer's two ages — four groups, as the app places them
 * (`agent-board-card.tsx`). The footer's second figure says `ago`, because a
 * bare duration beside `up` read as noise (`metaLine`).
 */
function renderCard(card, index) {
  const what =
    card.task === undefined
      ? card.label
      : `<span class="scene-board__prefix">Task</span> ${card.task}`;

  return `
        <article class="scene-board__card" data-state="${card.state}" style="--scene-delay: ${160 + index * 70}ms">
          <div class="scene-board__status">
            ${renderStageStatusMark(card.state, "scene-board__mark")}
            <span class="scene-board__state">${card.state}</span>
          </div>
          <span class="scene-board__num">${formatRank(card.rank)}</span>
          <div class="scene-board__id">
            ${sceneAgentMark(card.agent, "scene-board__glyph", 15)}
            <span class="scene-board__name">${displayName(card.agent)}</span>
          </div>
          <div class="scene-board__where">${card.where}</div>
          <div class="scene-board__what">${what}</div>
          <div class="scene-board__meta">up ${card.up} · ${card.changed} ago</div>
        </article>
      `;
}

function boardBody() {
  const cards = boardCards();

  return `
    <div class="scene scene-board">
      <div class="scene-board__heading">${cards.length} of ${cards.length}</div>
      <div class="scene-board__grid">${cards.map(renderCard).join("")}</div>
    </div>
  `;
}

export function board() {
  return frame(boardBody(), { rail: BOARD_PROJECTS, strip: BOARD_STRIP });
}
