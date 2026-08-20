/**
 * Panel 5 — the token usage dashboard.
 *
 * Usage → OVERVIEW, not Daily. The spec asked for "range selector + a metric
 * table" and that composite exists on no single Usage view: the range selector
 * belongs to Overview alone (`src/ui/usage/sections/overview-section.tsx:246`)
 * and Overview has no table at all — only Daily and Breakdown mount
 * `MetricTable`. Drawing the two together would be inventing a screen, so this
 * scene draws Overview and draws NO table, NO `thead`, NO column headers.
 *
 * Shape mirrors `OverviewSection`: eyebrow → the display figure and its
 * asterisk → footnote → the range selector → the estimate note → one row per
 * agent. The left rail names all three views, which is what stops one honest
 * drawing of Overview from implying Usage has a single screen.
 *
 * Nothing here is interactive. The whole `.a-appwin__body` is `aria-hidden`,
 * so the nav items and range options are spans where the app has buttons: a
 * focusable node inside a hidden subtree is a defect, and a control that
 * cannot be pressed is a promise a drawing cannot keep. Every rail row in
 * `marketing/stage/appwin.js` takes `tabindex="-1"` for the same reason.
 */

import { SCENE_RAIL, frame, sceneAgentMark } from "./chrome.js";

/**
 * The three views in display order (`src/ui/usage/usage-views.ts:34-48`),
 * Overview active.
 */
const VIEWS = ["Overview", "Daily", "Breakdown"];
const ACTIVE_VIEW = "Overview";

/**
 * Range labels verbatim from `src/ui/usage/usage-ranges.ts:29-44`. `All` is
 * the active one because `DEFAULT_USAGE_RANGE` is `all` (:47) — a resting
 * Usage tab is showing the whole recorded history, so that is the state the
 * figure above belongs to.
 */
const RANGES = ["Today", "7 days", "30 days", "All"];
const ACTIVE_RANGE = "All";

/**
 * The display figure and the two lines that qualify it, all three verbatim in
 * form from the app.
 *
 * `TOTAL` carries no asterisk of its own: the app writes
 * `${formatUsd(total)}*` into the figure and the footnote answers it, so the
 * two are one sentence split across two lines rather than two claims. The
 * footnote is the default of `OverviewSection`'s four — a priced total with no
 * unpriced models — which is the only one that stays short enough to read in a
 * `side` panel.
 *
 * The estimate note is `ESTIMATE_NOTE` (`src/ui/usage/usage-format.ts:53`)
 * resolved against `PRICING_SNAPSHOT_DATE`
 * (`src/lib/usage-pricing-snapshot.ts:28`). The date is a fact about the
 * shipped pricing table and moves when that table does.
 */
const EYEBROW = "Raw token cost";
const TOTAL = "$13,372.98";
const FOOTNOTE = "* if billed at full API rate";
const ESTIMATE = "estimated at API prices · pricing snapshot 2026-08-10";

/**
 * Exactly two rows — and they are not a sample of a longer list.
 * `USAGE_AGENT_LABEL` (`src/ui/usage/usage-format.ts:42-45`) covers `claude`
 * and `codex` and nothing else, because those are the two corpora the scanner
 * reads; the panel's own copy claims exactly that coverage. The labels are
 * that table's, so the drawing and the app cannot disagree about what the tool
 * is called.
 *
 * The figures are consistent by construction: the two amounts sum to `TOTAL`
 * and the two shares sum to 100.0, which is what `largestRemainderShares`
 * (`overview-section.tsx:73-100`) guarantees on real data. A reader who adds
 * the column up is entitled to get the number at the top.
 *
 * `share` is a datum rather than a style, so it rides the markup as `--share`
 * — the same reason the app sets that width inline. The COLOUR is deliberately
 * not here: the stylesheet keys it off `data-agent`, the way the neighbouring
 * scenes leave `state` to be painted by CSS instead of carrying tokens
 * themselves. The app's own mapping is `dotColor(agent)`
 * (`src/lib/process-info.ts:22-33`): claude is the theme magenta, codex the
 * theme green.
 */
const AGENTS = [
  {
    id: "claude",
    label: "Claude Code",
    amount: "$5,509.67",
    share: "41.2",
    tokens: "1.2B",
  },
  {
    id: "codex",
    label: "Codex",
    amount: "$7,863.31",
    share: "58.8",
    tokens: "2.4B",
  },
];

/**
 * The scene's body alone — exported so the hero's scene switcher can stand it
 * behind the hero's live rail instead of the resting `SCENE_RAIL`.
 */
export function usageBody() {
  const views = VIEWS.map(
    (label) => `
      <span class="scene-usage__navitem${label === ACTIVE_VIEW ? " is-active" : ""}">${label}</span>
    `,
  ).join("");

  const ranges = RANGES.map(
    (label) => `
      <span class="scene-usage__option${label === ACTIVE_RANGE ? " is-active" : ""}">${label}</span>
    `,
  ).join("");

  // 18px is `sceneAgentMark`'s default and the app's own `.usage-agent__logo`
  // box, so the two agree without this file naming a number.
  const agents = AGENTS.map(
    (agent) => `
      <li class="scene-usage__agent" data-agent="${agent.id}">
        <div class="scene-usage__line">
          ${sceneAgentMark(agent.id, "scene-usage__logo")}
          <span class="scene-usage__label">${agent.label}</span>
          <span class="scene-usage__amount">${agent.amount}</span>
        </div>
        <div class="scene-usage__bar">
          <span class="scene-usage__fill" style="--share: ${agent.share}%"></span>
        </div>
        <p class="scene-usage__sub">${agent.share}% of cost · ${agent.tokens} tokens</p>
      </li>
    `,
  ).join("");

  return `
      <div class="scene scene-usage">
        <nav class="scene-usage__nav">${views}</nav>
        <div class="scene-usage__view">
          <p class="scene-usage__eyebrow">${EYEBROW}</p>
          <p class="scene-usage__figure">${TOTAL}*</p>
          <p class="scene-usage__footnote">${FOOTNOTE}</p>
          <div class="scene-usage__range">${ranges}</div>
          <p class="scene-usage__estimate">${ESTIMATE}</p>
          <ul class="scene-usage__agents">${agents}</ul>
        </div>
      </div>
    `;
}

export function usage() {
  return frame(usageBody(), { rail: SCENE_RAIL });
}
