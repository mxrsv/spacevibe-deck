/**
 * The window chrome every panel scene stands in.
 *
 * The tour's single morphing window could only ever tell the three beats the
 * 16-second reel already tells. The panels are purpose-built drawings, one per
 * feature, in the same `.a-appwin` chrome as the hero stage — a scene is a
 * BODY for that chrome, never a new window. This module is that chrome, and
 * the six scene modules beside it are the bodies.
 *
 * Everything in a scene is a drawing of the real product, not a screenshot of
 * it: the class names are the landing's own (`scene-*`), sized in `cqw`
 * against the window's container so a scene scales with the panel it sits in,
 * exactly as the terminal panes do.
 */

import { AGENT_MARKS, renderAgentMark } from "../../agent-strip.js";
import { renderStageRail, renderStageStrip } from "../../appwin.js";
import { STAGE_ARIA_LABEL, deepFreeze } from "../../product-stage.js";

const MARK_BY_ID = Object.fromEntries(AGENT_MARKS.map((agent) => [agent.id, agent]));

/**
 * One agent mark for a scene, looked up by id.
 *
 * The scenes carry agent IDS (`"claude"`), while `renderAgentMark` takes the
 * catalog ENTRY — so the lookup has to happen somewhere, and one copy here
 * beats one copy in each scene that draws a mark. An id the catalog does not
 * know falls back to a synthetic markless entry rather than throwing, which is
 * what the old local `agentMark` did: it read `agent.mark` off `undefined`.
 *
 * 18px is the scene rung of the plan's size set (20 strip / 18 scenes / 15
 * catalog rows); the catalog scene passes its own.
 *
 * @param {string} id agent id, as the scene fixtures spell it
 * @param {string} className the caller's base class, carried by both branches
 * @param {number} [size] intrinsic size in px
 */
export function sceneAgentMark(id, className, size = 18) {
  const agent = MARK_BY_ID[id] ?? { id, label: id, mark: null };

  return renderAgentMark(agent, className, size);
}

/**
 * The rail a scene that is not ABOUT the rail can stand on.
 *
 * Two clusters and four rows — the hero's live half, compressed: one framed
 * multi-agent tab (DL-27.19, no parent row) and one bare single-pane tab. It
 * is a RESTING frame, so no cluster is collapsed and none is hovered, which
 * means no caret and no `+` paint on it; panel 1 is where those get said.
 *
 * Every `id` is null. A scene mounts no stream, and a `data-tail` hook with
 * nothing driving it is a hook that lies about being live.
 *
 * Frozen because six modules share this one object: a scene that spread it and
 * edited a pane in place would silently repaint every other panel.
 */
export const SCENE_RAIL = deepFreeze([
  {
    project: "spacevibe-deck",
    tabs: [
      {
        framed: true,
        panes: [
          {
            id: null,
            agent: "claude",
            message: "I'll trace why the pane divider drifts on resize.",
            age: "now",
            state: "working",
          },
          {
            id: null,
            agent: "codex",
            message: "96 passed · 0 failed",
            age: "2m",
            state: "done",
          },
          {
            id: null,
            agent: "opencode",
            message: "typecheck clean · the branch follows cwd now",
            age: "2m",
            state: "done",
          },
        ],
      },
    ],
  },
  {
    project: "spacevibe-api",
    tabs: [
      {
        framed: false,
        panes: [
          {
            id: null,
            agent: "gemini",
            message: "Should I apply the pending migration?",
            age: "3h",
            state: "asked",
          },
        ],
      },
    ],
  },
]);

/**
 * One `.a-appwin__stage` region: the tab strip, then the scene body.
 *
 * Split out of `frame()` for the hero's scene switcher (2026-08-20): the hero
 * keeps ONE rail alive and swaps several of these regions behind it, so the
 * region has to be composable without the figure around it. `attrs` is the
 * switcher's seam — `data-scene` and `hidden` ride there — and defaults to
 * nothing so every `frame()` caller keeps the exact markup it had.
 *
 * @param {string} body the scene's own markup
 * @param {object[] | null} [strip] chips for `renderStageStrip`, or none
 * @param {string} [attrs] extra attributes for the region element
 */
export function stageRegion(body, strip = null, attrs = "") {
  return `
        <div class="a-appwin__stage"${attrs}>
          ${strip ? renderStageStrip(strip) : ""}
          ${body}
        </div>
  `;
}

/**
 * Wraps a scene body in the shared window chrome.
 *
 * The composition is the hero's, with `body` standing where the pane grid
 * stands: rail, then a `.a-appwin__stage` holding the tab strip and the body.
 * There is no status bar — `showStatusBar` defaults to false in the app, so
 * the window's bottom edge is the work area.
 *
 * `rail: null` omits the `<aside>` entirely, which is what a scene that draws
 * its own left column wants: `.a-appwin__sidebar + *` is an adjacency, so with
 * no aside the stage takes no left seam.
 *
 * @param {string} body the scene's own markup
 * @param {{ rail?: object[] | null, strip?: object[] | null }} [options]
 */
export function frame(body, { rail = SCENE_RAIL, strip = null } = {}) {
  return `
    <figure class="a-appwin tour__appwin" role="img" aria-label="${STAGE_ARIA_LABEL}">
      <div class="a-appwin__body" aria-hidden="true">
        ${rail ? renderStageRail(rail) : ""}
        ${stageRegion(body, strip)}
      </div>
    </figure>
  `;
}
