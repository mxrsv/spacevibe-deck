/**
 * Shared app-window (".a-appwin") renderers — the mock of the real Deck
 * window. The landing hero, the scroll tour and the marketing video all
 * assemble the same chrome from here (styles live in direction-a.css).
 */

import { BRAND } from "./brand.js";
import { stageSidebar, stageStatus } from "./stage-data.js";

export const BRAND_ICON_SRC = BRAND.iconSrc;

export const STAGE_ICONS = {
  splitRow:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><line x1="12" y1="4.5" x2="12" y2="19.5"/>',
  splitColumn:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><line x1="3.5" y1="12" x2="20.5" y2="12"/>',
  closePane:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 9.5l5 5m0-5l-5 5"/>',
  expand:
    '<path d="M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v3"/><path d="M15 4.5h3a1.5 1.5 0 0 1 1.5 1.5v3"/><path d="M9 19.5H6A1.5 1.5 0 0 1 4.5 18v-3"/><path d="M15 19.5h3a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.08a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z"/>',

  /*
   * Everything below joined the set with the 2026-08-20 redesign: the frame
   * row, the rail and the tab strip draw them. They keep the five above's
   * convention — inner SVG for one 24-grid `renderChromeIcon` box, stroked
   * from `currentColor` — so any caller can hand any key to that one renderer.
   * Where the app draws a Phosphor icon at `fill` (`deck-icon.tsx:31-38`) the
   * shape carries its own `fill="currentColor" stroke="none"`, since the
   * wrapper opens with `fill="none"`.
   */

  /*
   * SidebarSimple, filled — the one icon the app draws solid everywhere
   * (`SOLID_ICONS`, deck-icon.tsx:38), because a panel toggle is a picture of
   * a layout and reads better as area. Phosphor's fill weight keeps the
   * window frame open and solidifies the sidebar column, which is what makes
   * the same glyph mean "the column beside this frame".
   */
  sidebar:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3v15H6A2.5 2.5 0 0 1 3.5 17Z" fill="currentColor" stroke="none"/>',
  /*
   * Plus, regular — the frame row's `New`, a closed card strip's trailing `+`
   * and an open card's `New agent` row. Since 1.1 those two are the ONLY
   * create controls a checkout has: the project header's `+` and the tab
   * strip's `+` both came off (`rail-create-consolidation`).
   */
  plus: '<path d="M12 4.75v14.5M4.75 12h14.5"/>',
  /*
   * SquaresFour, regular — the Agent Board's own tab chip (`tab-strip.tsx`,
   * the `Agents` chip). Four rounded squares at Phosphor's proportions.
   */
  squares:
    '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  /*
   * GitBranch, regular — a worktree card's branch badge (`worktree-card.tsx`,
   * `Badge`). The primary checkout's `Primary` badge carries no glyph.
   */
  branch:
    '<circle cx="6.5" cy="6" r="2.25"/><circle cx="6.5" cy="18" r="2.25"/><circle cx="17.5" cy="6" r="2.25"/><path d="M6.5 8.25v7.5"/><path d="M17.5 8.25v1.25a3 3 0 0 1-3 3h-5a3 3 0 0 0-3 3"/>',
  /*
   * DotsThreeOutline at `fill`, never `DotsThree` at `fill`
   * (feature-toolbar.tsx:235-249): the bare glyph knocks its dots out of a
   * solid tile, and DotsThreeOutline's `regular` rings all but vanish at this
   * size. Three solid discs is what the toolbar's `More` actually draws.
   */
  dots: '<circle cx="4.5" cy="12" r="2.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><circle cx="19.5" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
  /** Globe — the browser chip's mark (tab-strip.tsx:251-253). */
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.75 5.3 3.75 8.5S14.4 18.1 12 20.5C9.6 18.1 8.25 15.2 8.25 12S9.6 5.9 12 3.5Z"/>',
  /*
   * The file chip's mark. The app picks a per-extension icon
   * (`fileIcon(tab.name)`, tab-strip.tsx:210) whose letters are illegible at
   * chip size, so the mock draws the generic page the family is built on.
   */
  file: '<path d="M14.5 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5Z"/><path d="M14.5 3.5v4a1 1 0 0 0 1 1h4"/>',
  /** X — a chip's close, and a remembered cluster's remove. */
  close: '<path d="M6.5 6.5l11 11m0-11l-11 11"/>',
  /** Folder — the first thing on every cluster header's line. */
  folder:
    '<path d="M3 18.5v-13A1.5 1.5 0 0 1 4.5 4h4.2a1.5 1.5 0 0 1 1.06.44l1.74 1.81h8A1.5 1.5 0 0 1 21 7.75v10.75a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>',
  /** CaretRight — the collapse affordance at a live header's trailing edge. */
  caret: '<path d="M9 5.25L15.75 12 9 18.75"/>',
  /** ArrowsClockwise — the agent catalog's "Refresh" beside its count. */
  refresh:
    '<path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5 9.2 9.2 0 0 0-6.36 2.6L3.5 8.25"/><path d="M3.5 3.5v4.75h4.75"/><path d="M3.5 12a8.5 8.5 0 0 0 8.5 8.5 9.2 9.2 0 0 0 6.36-2.6l2.14-2.15"/><path d="M20.5 20.5v-4.75h-4.75"/>',
};

export function renderChromeIcon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/**
 * The frame — the head of the navigation column, mirroring the app's
 * `.deck-frame` (DL-18.3): traffic lights and window actions on the rail's
 * ground, with the stage reaching the window's top edge beside it. It is
 * rendered by `renderStageSidebar`, not composed above the body, because
 * since the 2026-08 redesign there is no full-width chrome band.
 */
export function renderStageTitlebar() {
  const icons = ["splitRow", "splitColumn", "closePane", "expand"]
    .map(
      (name) =>
        `<span class="a-appwin__iconbtn">${renderChromeIcon(STAGE_ICONS[name])}</span>`,
    )
    .join("");

  return `
    <div class="a-appwin__titlebar">
      <span class="a-appwin__lights"><i></i><i></i><i></i></span>
      <span class="a-appwin__actions">
        ${icons}
        <span class="a-appwin__actionsep"></span>
        <span class="a-appwin__iconbtn">${renderChromeIcon(STAGE_ICONS.gear)}</span>
      </span>
    </div>
  `;
}

/**
 * Workspace sidebar. `statusById` optionally decorates avatars with the
 * app's live indicators — "busy" (spinning agent ring) or "unread" (yellow
 * dot) — used by the tour; the hero passes nothing and stays as shipped.
 *
 * @param {Record<string, "busy" | "unread"> | undefined} statusById
 */
export function renderStageSidebar(statusById = undefined) {
  const items = stageSidebar
    .map((item) => {
      const status = statusById?.[item.id];
      const logo =
        item.monogram === null
          ? `<img class="a-appwin__wslogo" src="${BRAND_ICON_SRC}" alt="" />`
          : `<span class="a-appwin__wslogo a-appwin__wslogo--mono" style="--ws-tint: ${item.tint}">${item.monogram}</span>`;
      // Only wrap when a status is asked for: the bare <img> is a direct flex
      // child in the hero, and an unstyled wrapper would break that row.
      const avatar = status
        ? `<span class="a-appwin__wsavatar" data-ws-avatar="${item.id}" data-ws-status="${status}">${logo}</span>`
        : logo;

      return `
        <div class="a-appwin__wsitem${item.active ? " is-active" : ""}" data-ws-item="${item.id}">
          ${avatar}
          <span class="a-appwin__wstext">
            <span class="a-appwin__wslabel">${item.label}</span>
            <span class="a-appwin__wspath">${item.path}</span>
          </span>
          ${item.active ? '<span class="a-appwin__wsclose">×</span>' : ""}
        </div>
      `;
    })
    .join("");

  return `
    <aside class="a-appwin__sidebar">
      ${renderStageTitlebar()}
      <div class="a-appwin__wslist">
        ${items}
        <div class="a-appwin__wsadd"><span>+</span>Open workspace</div>
      </div>
    </aside>
  `;
}

export function renderStagePane(pane) {
  const footer = pane.footer
    .map(
      (line) =>
        `<span class="a-appwin__footline${line.cls ? ` ${line.cls}` : ""}">${line.text}</span>`,
    )
    .join("");

  return `
    <article class="a-appwin__pane${pane.focused ? " is-focused" : ""}" data-pane="${pane.id}">
      <div class="a-appwin__transcript" data-stream="${pane.id}">
        <div class="a-appwin__lines" data-lines></div>
        <div class="a-appwin__spinner" data-spinner hidden></div>
      </div>
      <div class="a-appwin__panefoot">
        <div class="a-appwin__promptbox">
          <span class="a-appwin__promptglyph">${pane.prompt}</span>
          <i class="a-appwin__cursor"></i>
        </div>
        ${footer}
      </div>
    </article>
  `;
}

export function renderStageStatus() {
  const hints = stageStatus.hints
    .map(
      (hint) =>
        `<span class="a-appwin__hint">${hint.label}</span><kbd class="a-appwin__kbd">${hint.key}</kbd>`,
    )
    .join("");

  return `
    <footer class="a-appwin__status">
      <span class="a-appwin__seg"><i class="a-appwin__gitdot"></i>${stageStatus.branch}</span>
      <span class="a-appwin__vsep"></span>
      <span class="a-appwin__seg a-appwin__seg--cwd">${stageStatus.cwd}</span>
      <span class="a-appwin__statusright">
        <span class="a-appwin__seg" data-status-panes>${stageStatus.paneCount}</span>
        <span class="a-appwin__vsep"></span>
        <span class="a-appwin__seg">${stageStatus.theme}</span>
        <span class="a-appwin__vsep"></span>
        <span class="a-appwin__seg">${hints}</span>
      </span>
    </footer>
  `;
}

/*
 * ---------------------------------------------------------------------------
 * The 2026-08-20 chrome: frame row, agent rail, tab strip.
 *
 * Everything above this line draws the July window and is kept because the
 * marketing video still renders it (`marketing/video/src/stage-driver.js`).
 * Everything below draws the shipped one, as of Deck 1.1: a rail of project
 * clusters whose checkouts are worktree cards — open ones list each agent's
 * newest sentence, closed ones fold their agents into a strip — and one strip
 * of one chip shape over the panes. The two sets share `STAGE_ICONS` and
 * `renderChromeIcon` and nothing else, so neither can quietly restyle the
 * other.
 *
 * All three new renderers are pure functions of their argument — no fixture is
 * read from module scope, which is what lets a tour scene hand in its own rail
 * without touching `stage-data.js`.
 * ---------------------------------------------------------------------------
 */

/**
 * Brand marks by agent id, mirroring the app's own `AGENT_LOGOS`
 * (`src/lib/agent-logos.ts:25-31`) — the same five files, and `cursor-agent`
 * deliberately absent so it falls to the monogram the app draws for it.
 *
 * Resolved through the module URL the way `brand.js` resolves the app mark,
 * not by `import`ing the files: an `import` of a `.svg` makes this module
 * unloadable outside a bundler, and both stage modules are read by plain Node.
 *
 * It is a second copy of the id → file mapping `AGENT_MARKS` holds in
 * `marketing/landing-prototype/src/agent-strip.js`, and knowingly so:
 * `marketing/stage/` is the layer the landing AND the video import, so it
 * cannot import back out of itself to share one table.
 */
const AGENT_MARK_SRC = {
  claude: new URL("../../src/assets/agent-claude.svg", import.meta.url).href,
  codex: new URL("../../src/assets/agent-codex.svg", import.meta.url).href,
  opencode: new URL("../../src/assets/agent-opencode.svg", import.meta.url).href,
  agy: new URL("../../src/assets/agent-agy.png", import.meta.url).href,
  gemini: new URL("../../src/assets/agent-gemini.svg", import.meta.url).href,
};

/** First alphanumeric character of an id, uppercased — `letterAvatar`'s rule. */
function monogramLetter(agent) {
  for (const char of agent.trim()) {
    if (/[a-z0-9]/i.test(char)) {
      return char.toUpperCase();
    }
  }

  return "?";
}

/**
 * One agent mark, brand file or not. The monogram appends `--mono` to the
 * caller's own class, the way the agent strip's helper does, so the rail leaf,
 * the tab row and the chip each keep their own geometry class.
 *
 * No intrinsic `width`/`height`: the whole window scales in container units,
 * and a pixel attribute here would be a second, wrong answer for one frame.
 *
 * @param {string} agent agent id, as `stageRail` and `stageStrip` spell it
 * @param {string} className the caller's base class, carried by both branches
 */
function renderStageAgentMark(agent, className) {
  const src = AGENT_MARK_SRC[agent];
  if (src === undefined) {
    return `<span class="${className} ${className}--mono">${monogramLetter(agent)}</span>`;
  }

  return `<img class="${className}" src="${src}" alt="" />`;
}

/**
 * `data-tail` / `data-dot`, or nothing at all.
 *
 * A pane with no id is a static row — a drawing the stream engine never
 * repaints — and an attribute spelled `data-tail="null"` would be a hook the
 * engine's `querySelectorAll` could still match by accident.
 */
function hookAttr(name, paneId) {
  return paneId === null || paneId === undefined ? "" : ` ${name}="${paneId}"`;
}

/*
 * The working ring, copied from `src/ui/workspace-spinner.tsx`: eight STILL
 * dots on a 26 box, the first at 12 o'clock. Nothing rotates — the stagger in
 * CSS runs a bright head around a geometry that never moves (DL-27.3), which
 * is why the `--dot` index below has to stay ZERO-BASED: the app's delay is
 * `calc((var(--dot) - 8) * 0.15s)`, so slot 0 starts at -1.2s and the ring is
 * already mid-cycle on its first painted frame. At 1…8 the last dot's delay
 * is 0s, nothing is negative, and the whole ring pops in.
 */
const SPINNER_COUNT = 8;
const SPINNER_DOTS = Array.from({ length: SPINNER_COUNT }, (_, i) => {
  const angle = (i / SPINNER_COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Number((13 + Math.cos(angle) * 10.4).toFixed(3)),
    y: Number((13 + Math.sin(angle) * 10.4).toFixed(3)),
  };
});

function renderWorkspaceSpinner() {
  const dots = SPINNER_DOTS.map(
    (dot, i) =>
      `<circle class="a-appwin__wsdot" cx="${dot.x}" cy="${dot.y}" r="2.2" style="--dot:${i}"/>`,
  ).join("");

  return `<svg class="a-appwin__wsspinner" viewBox="0 0 26 26" fill="currentColor" aria-hidden="true">${dots}</svg>`;
}

/**
 * The status mark the Agent Board's cards still draw (`RailStatusMark`, in
 * `agent-board-card.tsx`): one 14px box in every state, a 9px dot for
 * `failed`, `asked`, `done` and `idle`, a square for `ended`, and the ring for
 * `working`. The rail itself stopped drawing this mark in 1.1 — its cards
 * wear the corner dot and the loading bars below.
 *
 * The ring's SVG is in the DOM in EVERY state and CSS decides what shows, so
 * a state is one attribute and every rule about the working state is written
 * `[data-state="working"]`, never as a `--spinner` modifier.
 *
 * @param {"failed" | "asked" | "working" | "done" | "idle" | "ended"} state
 * @param {string} className the caller's geometry class
 */
export function renderStageStatusMark(state, className) {
  return `<span class="a-appwin__mark ${className}" data-state="${state}">${renderWorkspaceSpinner()}</span>`;
}

/*
 * DL-27.3's fold (`agent-rail-model.ts`): the loudest pane speaks for a
 * group, ties going to the pane that came first.
 */
const STATE_RANK = { failed: 4, asked: 3, working: 2, done: 1, ended: 1, idle: 0 };

/*
 * The closed strip's fold, `fitSegments` with the app's own fallback widths
 * (`agent-rail-card-model.ts`): a plain segment 39px, +21 for a `×N` count,
 * the `+` 30, the `+N` tail 31, inside a 220px budget. The app then MEASURES
 * the real boxes; a drawing has nothing to measure, so the fallbacks are the
 * whole rule here — plus the working bars, which the fallback leaves out and
 * which put a busy segment near 55px. The `+` never folds.
 */
const STRIP_WIDTH = { segment: 39, count: 21, busy: 16, add: 30, overflow: 31, budget: 220 };

/**
 * Every agent KIND on a checkout, loudest group first (`groupSegments`): a
 * segment is one kind, however many panes run it, and wears one mark — its
 * loudest pane's.
 *
 * @param {Array<{ agent: string, state: string }>} panes
 */
function groupSegments(panes) {
  const agents = [...new Set(panes.map((pane) => pane.agent))];

  return agents
    .map((agent, order) => {
      const members = panes.filter((pane) => pane.agent === agent);
      const state = members.reduce(
        (loudest, pane) => (STATE_RANK[pane.state] > STATE_RANK[loudest] ? pane.state : loudest),
        members[0].state,
      );

      return { agent, count: members.length, state, order };
    })
    .sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || a.order - b.order);
}

function segmentWidth(group) {
  return (
    STRIP_WIDTH.segment +
    (group.count > 1 ? STRIP_WIDTH.count : 0) +
    (group.state === "working" ? STRIP_WIDTH.busy : 0)
  );
}

/**
 * Fold agent kinds until the segments, the `+N` tail and the `+` fit. The
 * prefix widths only grow, so a filter on them is the app's take-while.
 */
function fitSegments(groups) {
  const widths = groups.map(segmentWidth);
  const total = widths.reduce((sum, width) => sum + width, 0);

  if (total + STRIP_WIDTH.add <= STRIP_WIDTH.budget) {
    return { shown: groups, overflow: 0 };
  }

  const room = STRIP_WIDTH.budget - STRIP_WIDTH.overflow - STRIP_WIDTH.add;
  const shown = groups.filter(
    (_, index) => widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0) <= room,
  );
  const overflow = groups.slice(shown.length).reduce((sum, group) => sum + group.count, 0);

  return { shown, overflow };
}

/*
 * The two state marks a card draws (`worktree-card-row.tsx`). Both are in the
 * DOM in every state and `data-state` on their parent decides what paints:
 * the three loading bars for `working`, the 5px dot for everything else, and
 * nothing for `idle` — so the stream engine repaints a streamed row by
 * writing one attribute, exactly as it did the old ring.
 */
const CARD_LOAD = `<span class="a-appwin__cardload"><i></i><i></i><i></i></span>`;
const CARD_DOT = `<span class="a-appwin__carddot"></span>`;

/**
 * A checkout's badge: the fact its name did not say. `role` is a bare word
 * (`Primary`); `branch` carries the GitBranch glyph.
 *
 * @param {{ kind: "role" | "branch", text: string }} badge
 * @param {string} className `__cardbadge` or `__barebadge`
 */
function renderCheckoutBadge(badge, className) {
  const glyph = badge.kind === "branch" ? renderChromeIcon(STAGE_ICONS.branch) : "";

  return `<span class="${className}" data-kind="${badge.kind}">${glyph}<span>${badge.text}</span></span>`;
}

/**
 * One closed-strip segment: glyph with its corner dot, the `×N` count when
 * several panes share the kind, and the bars when it is working.
 */
function renderStripSegment(group) {
  const count = group.count > 1 ? `<span class="a-appwin__cardtimes">×${group.count}</span>` : "";
  const load = group.state === "working" ? CARD_LOAD : "";

  return `
          <span class="a-appwin__cardseg" data-state="${group.state}">
            <span class="a-appwin__cardglyph">${renderStageAgentMark(group.agent, "a-appwin__cardlogo")}${CARD_DOT}</span>
            ${count}
            ${load}
          </span>
        `;
}

/**
 * A closed card's agents as ONE segmented bar, then the `+N` tail for what
 * did not fit, then the checkout's `+`.
 */
function renderCardStrip(panes) {
  const { shown, overflow } = fitSegments(groupSegments(panes));
  const more =
    overflow > 0 ? `<span class="a-appwin__cardseg a-appwin__cardseg--more">+${overflow}</span>` : "";

  return `
        <div class="a-appwin__cardstrip">
          ${shown.map(renderStripSegment).join("")}
          ${more}
          <span class="a-appwin__cardseg a-appwin__cardseg--add">${renderChromeIcon(STAGE_ICONS.plus)}</span>
        </div>
      `;
}

/**
 * One agent row of an open card: glyph · label · state (DL-27.21). The label
 * is the pane's latest sentence — the `data-tail` hook — and the status cell
 * is the `data-dot` hook.
 *
 * No model pill: production withholds it while the pane → session pairing is
 * heuristic. No close either — the app's hover close is deliberately NOT
 * drawn, since a close that cannot close is a worse lie than an absent one.
 */
function renderCardRow(pane) {
  const focused = pane.focused === true ? ' data-focused="true"' : "";

  return `
          <div class="a-appwin__cardrow"${focused}>
            <span class="a-appwin__cardglyph">${renderStageAgentMark(pane.agent, "a-appwin__cardlogo")}</span>
            <span class="a-appwin__cardlabel"${hookAttr("data-tail", pane.id)}>${pane.label}</span>
            <span class="a-appwin__cardstatus" data-state="${pane.state}"${hookAttr("data-dot", pane.id)}>${CARD_LOAD}${CARD_DOT}</span>
          </div>
        `;
}

/** The open card's create control — the closed strip's `+`, in row form. */
function renderNewAgentRow() {
  return `
          <div class="a-appwin__cardnew">
            <span class="a-appwin__cardglyph">${renderChromeIcon(STAGE_ICONS.plus)}</span>
            <span class="a-appwin__cardlabel">New agent</span>
          </div>
        `;
}

/**
 * A checkout's chosen worktree colour (`worktreeColorStyle`, DL-27.25), as the
 * `--worktree-color` the card's mark, frame and badge read. `color` is a CSS
 * colour; absent means Default, which emits nothing.
 *
 * @param {{ color?: string }} checkout
 */
function worktreeColorAttr(checkout) {
  return checkout.color ? ` style="--worktree-color: ${checkout.color}"` : "";
}

/**
 * A checkout with agents: head (mark, name, badge, chevron), the age, then
 * either the rows (open) or the strip (closed).
 *
 * The head's mark turns busy off the CSS `:has()` of a working state inside
 * the card rather than off a flag written here, so the hero's streamed card
 * goes quiet with its panes.
 */
function renderCheckoutCard(checkout) {
  const open = checkout.open === true;
  const meta = checkout.age ? `<p class="a-appwin__cardmeta">${checkout.age}</p>` : "";
  const body = open
    ? `
        <div class="a-appwin__cardcount">${checkout.panes.length} active</div>
        ${checkout.panes.map(renderCardRow).join("")}
        ${renderNewAgentRow()}
      `
    : renderCardStrip(checkout.panes);

  return `
      <article class="a-appwin__card" data-open="${open}" data-active="${checkout.active === true}"${worktreeColorAttr(checkout)}>
        <div class="a-appwin__cardhead">
          <span class="a-appwin__cardmark"></span>
          <span class="a-appwin__cardname">${checkout.name}</span>
          ${renderCheckoutBadge(checkout.badge, "a-appwin__cardbadge")}
          <span class="a-appwin__cardchevron">${renderChromeIcon(STAGE_ICONS.caret)}</span>
        </div>
        ${meta}
        ${body}
      </article>
    `;
}

/**
 * A checkout with nothing open: the head row's shape alone — no box, no age,
 * no strip. In the app the whole row is that checkout's create control.
 */
function renderBareCheckout(checkout) {
  return `
      <div class="a-appwin__bare"${worktreeColorAttr(checkout)}>
        <span class="a-appwin__baremark"></span>
        <span class="a-appwin__barename">${checkout.name}</span>
        ${renderCheckoutBadge(checkout.badge, "a-appwin__barebadge")}
      </div>
    `;
}

function renderCheckout(checkout) {
  return checkout.panes.length === 0 ? renderBareCheckout(checkout) : renderCheckoutCard(checkout);
}

/**
 * One project cluster.
 *
 * The header is a TWO-TRACK GRID HOLDING TWO CHILDREN: the caret lives inside
 * `.a-appwin__clustertoggle`, which spans both tracks, and the close is laid
 * over track 2 — the app's pin-to-overlap idiom, where the two trade the slot
 * on hover (`04a-agent-rail.css:175-330` at build/v1.1.1). There is no `+`
 * here any more: every checkout carries its own.
 *
 * A remembered project swaps that toggle for a still span in track 1 and has
 * NO caret element at all — there is nothing to collapse, so the disclosure
 * is omitted rather than disabled (DL-19.7). Its checkouts print as bare rows,
 * which are its way back in.
 *
 * `is-hover` is a state the DATA asks for, so a scene can bake one reveal; the
 * live page's own hover is CSS, and at rest a header is folder → name and
 * nothing else. A collapsed cluster draws no checkouts, exactly as the app's
 * `{!collapsed && group.worktrees.map(…)}` does, and keeps its caret visible.
 */
function renderRailCluster(cluster) {
  const hover = cluster.hovered === true ? " is-hover" : "";
  const folder = `<span class="a-appwin__clusterfolder">${renderChromeIcon(STAGE_ICONS.folder)}</span>`;
  const name = `<span class="a-appwin__clustername">${cluster.project}</span>`;
  const remove = `<span class="a-appwin__clusterremove">${renderChromeIcon(STAGE_ICONS.close)}</span>`;

  const head =
    cluster.remembered === true
      ? `
      <div class="a-appwin__clusterhead is-still${hover}">
        <span class="a-appwin__clusterstill">
          ${folder}
          ${name}
        </span>
        ${remove}
      </div>
    `
      : `
      <div class="a-appwin__clusterhead${hover}">
        <span class="a-appwin__clustertoggle">
          ${folder}
          ${name}
          <span class="a-appwin__clustercaret">${renderChromeIcon(STAGE_ICONS.caret)}</span>
        </span>
        ${remove}
      </div>
    `;

  const collapsed = cluster.collapsed === true;
  const checkouts = collapsed ? "" : cluster.checkouts.map(renderCheckout).join("");

  return `
    <section class="a-appwin__cluster${collapsed ? " is-collapsed" : ""}">
      ${head}
      ${checkouts}
    </section>
  `;
}

/**
 * The frame row — traffic lights, the sidebar toggle, `New`, and the drag
 * spacer, and nothing else. In sidebar mode the app passes `toolbar={null}`
 * (`app.tsx:1390`): the feature toolbar lives at the stage strip's trailing
 * end, not up here.
 *
 * It stands inside the rail rather than above the body because the rail and
 * the frame row share one ground (`--sidebar-bg`), which is what makes the
 * window's top-left corner seamless (`02-shell.css:35-42`).
 */
export function renderStageFrameRow() {
  return `
      <div class="a-appwin__framerow">
        <span class="a-appwin__lights"><i></i><i></i><i></i></span>
        <span class="a-appwin__ctl a-appwin__sidebartoggle">${renderChromeIcon(STAGE_ICONS.sidebar)}</span>
        <span class="a-appwin__new"><i class="a-appwin__newglyph">${renderChromeIcon(STAGE_ICONS.plus)}</i>New</span>
        <span class="a-appwin__framespacer"></span>
      </div>
    `;
}

/**
 * The agent rail: the frame row, then one section per project cluster.
 *
 * `.a-appwin__sidebar` is KEPT as the outer class and `a-appwin__rail` rides
 * beside it. `.a-appwin__sidebar + *` carries the window's one structural
 * seam and `.a-appwin__sidebar { display: none }` is the whole mobile
 * strategy; both fire off this element's class with no error if it is
 * renamed, in the hero, the tour and the video alike.
 *
 * @param {Array<{ project: string, remembered?: boolean, collapsed?: boolean,
 *                 hovered?: boolean, checkouts: Array<{ name: string,
 *                 badge: { kind: "role" | "branch", text: string }, age?: string,
 *                 open?: boolean, active?: boolean, panes: Array<object> }> }>} rail
 */
export function renderStageRail(rail) {
  const clusters = rail.map(renderRailCluster).join("");

  return `
    <aside class="a-appwin__sidebar a-appwin__rail">
      ${renderStageFrameRow()}
      <div class="a-appwin__raillist">
        ${clusters}
      </div>
    </aside>
  `;
}

/**
 * One chip. Its mark is decided by `kind` alone — a terminal chip draws its
 * agent's brand glyph, a file chip a file-type icon, the browser chip a globe
 * — all in the one `a-appwin__chiplogo` slot, so the three differ by glyph and
 * by nothing else (DL-18.10).
 *
 * A terminal chip carries NO colour dot, NO attention mark and no rename
 * affordance: all three came off the strip on 2026-08-16, and agent state is
 * the rail's job. The close renders on the active chip only — it is resting
 * chrome there (`05-tab-bar-toolbar.css:169-172`), where on a quiet chip it
 * would be a control that appears on hover and then does nothing.
 */
const CHIP_ICONS = {
  file: STAGE_ICONS.file,
  browser: STAGE_ICONS.globe,
  board: STAGE_ICONS.squares,
};

function renderStripChip(chip) {
  const active = chip.active === true;
  const mark =
    chip.kind === "terminal"
      ? renderStageAgentMark(chip.agent, "a-appwin__chiplogo")
      : `<span class="a-appwin__chiplogo">${renderChromeIcon(CHIP_ICONS[chip.kind])}</span>`;
  const close = active
    ? `<span class="a-appwin__chipclose">${renderChromeIcon(STAGE_ICONS.close)}</span>`
    : "";

  return `
        <div class="a-appwin__chip${active ? " is-active" : ""}" data-kind="${chip.kind}">
          ${mark}
          <span class="a-appwin__chiplabel"${hookAttr("data-tail", chip.paneId)}>${chip.label}</span>
          ${close}
        </div>
      `;
}

/**
 * The tab strip: the chips, then the trailing actions — `More` and the
 * side-panel toggle, in that order (`app.tsx:1462-1509`; the panel toggle is
 * present because `dockOpen` defaults to false). No `+` after the chips since
 * 1.1: ⌘T raises the New Agent list instead (`rail-create-consolidation`).
 *
 * The toggle's glyph is mirrored HERE, in the markup, rather than by a CSS
 * transform: it is the same SidebarSimple the frame row draws, and the app
 * flips it because this one points at a panel on the right (`DeckIcon`'s
 * `mirrored` clause, DL-14.1). Mirroring it again in CSS would restore it.
 *
 * @param {Array<{ kind: "terminal" | "file" | "browser" | "board", agent?: string,
 *                 paneId?: string | null, label: string, active: boolean }>} strip
 */
export function renderStageStrip(strip) {
  const chips = strip.map(renderStripChip).join("");
  const dockGlyph = `<g transform="translate(24 0) scale(-1 1)">${STAGE_ICONS.sidebar}</g>`;

  return `
      <div class="a-appwin__strip">
        <div class="a-appwin__chips">
          ${chips}
        </div>
        <div class="a-appwin__stripactions">
          <span class="a-appwin__ctl">${renderChromeIcon(STAGE_ICONS.dots)}</span>
          <span class="a-appwin__ctl">${renderChromeIcon(dockGlyph)}</span>
        </div>
      </div>
    `;
}
