/**
 * Panel 1 — the agent rail.
 *
 * The panel the rail is ABOUT, so it is the one scene that does not stand on
 * the shared `SCENE_RAIL`: it passes its own fixture to the same renderer and
 * lets the window's own left column be the drawing. Nothing here hand-rolls a
 * row — `renderStageRail` is the single source of the rail's markup, in the
 * hero, in the five other panels and here, so a change to a row's shape cannot
 * land in one place and miss the other two.
 *
 * The panel is `flip: true` (§3.6), so the window's rail sits on the reader's
 * right, next to the sentence that explains it.
 *
 * Four clusters cover every state the app's rail has, and every one of them is
 * a frame the app really produces at rest:
 *
 *   1. a live project whose multi-agent tab is framed — three flat leaves
 *      inside one inset hairline and NO parent row, because `PANE_TREE_HIDDEN`
 *      is true (D7). The framed item paints no selection wash;
 *   2. a live project of single-pane tabs — bare rows, red, yellow and quiet;
 *   3. a COLLAPSED project — the one resting state in which the caret is
 *      visible (D6), and it draws no rows at all;
 *   4. a REMEMBERED project, hovered — folder and name with no caret element
 *      in the markup at all, and the reveal baked so the per-project launcher
 *      gets said somewhere on the page (D6, §1.1).
 *
 * The hover on cluster 4 is the plan's single baked one. Everything else is at
 * rest: no other header shows a caret or a `+`, because the live page reveals
 * those on real hover and a drawing that shows them everywhere would be
 * claiming they are always on.
 */

import { deepFreeze } from "../../product-stage.js";
import { frame } from "./chrome.js";

/**
 * This panel's rail.
 *
 * Every `id` is null: a panel mounts no stream, and a `data-tail` hook with
 * nothing driving it is markup that claims to be live and is not. The sentences
 * are therefore the whole story the panel tells, and they are chosen to match
 * the panel's own copy — claude, codex and opencode are the three agents whose
 * session logs Deck can actually read today, so they are the three that carry a
 * sentence here. The row that carries none is a gemini pane, which is honest
 * twice over: it has not run yet, and its scanner answers null anyway.
 *
 * Frozen for the same reason the shared rail is: a fixture that can be edited
 * in place is a fixture that can be edited by accident.
 */
const PANEL_RAIL = deepFreeze([
  /*
   * The hero's own multi-agent tab, zoomed. Deliberately the same three
   * sentences: this panel is the hero's rail read at a size where it can be
   * read, not a second window with a second story.
   */
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
  /*
   * Single-pane tabs, so each renders as a bare row rather than a framed leaf.
   * Three rows, not the two the panel's headline names: `idle` is a rail state
   * like the other four and this is the only cluster with room for it, since
   * the framed tab is fixed at three leaves and a collapsed cluster draws no
   * rows for a state to appear on.
   */
  {
    project: "spacevibe-api",
    tabs: [
      {
        framed: false,
        panes: [
          {
            id: null,
            agent: "codex",
            message: "npm run build failed — DATABASE_URL is unset.",
            age: "4m",
            state: "failed",
          },
        ],
      },
      {
        framed: false,
        panes: [
          {
            id: null,
            agent: "claude",
            message: "Should I apply the pending migration?",
            age: "3h",
            state: "asked",
          },
        ],
      },
      /*
       * A pane that has not run. There is no turn to print, so the row keeps
       * its agent's name — the app's own fallback — and carries no age,
       * because nothing has changed for an age to measure.
       */
      {
        framed: false,
        panes: [
          {
            id: null,
            agent: "gemini",
            message: "Gemini CLI",
            age: "",
            state: "idle",
          },
        ],
      },
    ],
  },
  /*
   * Collapsed. Its rows exist and are simply not drawn — the app's own
   * `{!collapsed && group.rows.map(…)}` — which is why the fixture still
   * carries one. The caret is the point: this is the only resting frame in
   * which the rail shows a disclosure at all.
   */
  {
    project: "spacevibe-arena",
    collapsed: true,
    tabs: [
      {
        framed: false,
        panes: [
          {
            id: null,
            agent: "claude",
            message: "Seeded 42 rooms · arena is up on 5174",
            age: "2d",
            state: "done",
          },
        ],
      },
    ],
  },
  /*
   * Remembered: a project whose last tab closed. It keeps a header and no
   * rows, and it has no caret element in the markup at all — there is nothing
   * to fold, so the disclosure is omitted rather than disabled (DL-19.7).
   * Hovered, so its `+` and its `×` paint: the `+` is a launcher into a
   * project with nothing running, which is exactly what a remembered row is
   * for, and this is the one place on the page it is said.
   */
  {
    project: "spacevibe-hub",
    remembered: true,
    hovered: true,
    tabs: [],
  },
]);

/**
 * The stage side, held down.
 *
 * Three faint panes — the three the framed tab up in the rail is reporting on
 * — and one line saying they are still going. The panel's subject is the
 * sentences on the left of this, so the work itself is present and out of
 * focus rather than absent: a blank half would say the rail is all there is.
 *
 * They are empty boxes on purpose. A pane in the app is a terminal with no
 * chrome of its own, so anything drawn inside one here would be an invention,
 * and a brand mark in a dimmed area is a bright thing in the place the eye is
 * being asked to leave.
 */
function renderQuietPanes() {
  return [0, 1, 2]
    .map(
      (index) => `
        <span
          class="scene-rail__pane"
          style="--scene-delay: ${180 + index * 90}ms"
        ></span>
      `,
    )
    .join("");
}

export function rail() {
  return frame(
    `
      <div class="scene scene-rail">
        <div class="scene-rail__panes">${renderQuietPanes()}</div>
        <p class="scene-rail__hint">the panes keep running</p>
      </div>
    `,
    { rail: PANEL_RAIL },
  );
}
