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
 * Three projects cover every shape the 1.1 rail has, and every one of them is
 * a frame the app really produces at rest:
 *
 *   1. a live project with an OPEN card — one row per agent, each printing
 *      what that agent last said — and a CLOSED card beside it, its agents
 *      folded into the segmented strip with the checkout's one `+`;
 *   2. a COLLAPSED project — the one resting state in which the caret is
 *      visible, and it draws no cards at all;
 *   3. a REMEMBERED project, hovered — folder and name with no caret element
 *      in the markup at all, its close revealed, and its checkout as a bare
 *      row: the way back into a project with nothing running.
 *
 * Between the open rows and the closed strip, all six states the card draws
 * are on screen: working (the bars), done, idle (a row with no mark), asked,
 * failed, and ended (the stop square).
 *
 * The hover on project 3 is the panel's single baked one. Everything else is
 * at rest: no other header shows a caret or a close, because the live page
 * reveals those on real hover and a drawing that shows them everywhere would
 * be claiming they are always on.
 */

import { deepFreeze } from "../../product-stage.js";
import { frame } from "./chrome.js";

/**
 * This panel's rail.
 *
 * Every `id` is null: a panel mounts no stream, and a `data-tail` hook with
 * nothing driving it is markup that claims to be live and is not. The open
 * card's sentences are therefore the whole story the panel tells, and they
 * are chosen to match the panel's own copy — claude, codex and opencode are
 * the three agents whose session logs Deck can actually read today, so they
 * are the ones that carry a sentence. The row that carries none is a gemini
 * pane, which is honest twice over: it has not run yet, and its scanner
 * answers null anyway — so the row keeps the agent's name, the app's own
 * fallback.
 *
 * Frozen for the same reason the shared rail is: a fixture that can be edited
 * in place is a fixture that can be edited by accident.
 */
const PANEL_RAIL = deepFreeze([
  /*
   * The hero's own open card, zoomed — deliberately the same sentences, so
   * this panel is the hero's rail read at a size where it can be read, not a
   * second window with a second story. Gemini replaces opencode's row for the
   * idle state; the closed worktree card carries the loud three.
   */
  {
    project: "spacevibe-deck",
    checkouts: [
      {
        name: "main",
        badge: { kind: "role", text: "Primary" },
        age: "now",
        open: true,
        active: true,
        panes: [
          {
            id: null,
            agent: "claude",
            label: "I'll trace why the pane divider drifts on resize.",
            state: "working",
            focused: true,
          },
          { id: null, agent: "codex", label: "96 passed · 0 failed", state: "done" },
          { id: null, agent: "gemini", label: "Gemini", state: "idle" },
        ],
      },
      {
        name: "detach",
        badge: { kind: "branch", text: "feat/detach" },
        age: "4m",
        panes: [
          {
            id: null,
            agent: "codex",
            label: "npm run build failed — DATABASE_URL is unset.",
            state: "failed",
          },
          {
            id: null,
            agent: "claude",
            label: "Should I apply the pending migration?",
            state: "asked",
          },
          { id: null, agent: "claude", label: "Which branch should the fix land on?", state: "asked" },
          { id: null, agent: "opencode", label: "OpenCode", state: "ended" },
        ],
      },
    ],
  },
  /*
   * Collapsed. Its cards exist and are simply not drawn — the app's own
   * `{!collapsed && group.worktrees.map(…)}` — which is why the fixture still
   * carries one. The caret is the point: this is the only resting frame in
   * which the rail shows a disclosure at all.
   */
  {
    project: "spacevibe-arena",
    collapsed: true,
    checkouts: [
      {
        name: "main",
        badge: { kind: "role", text: "Primary" },
        age: "2d",
        panes: [
          {
            id: null,
            agent: "claude",
            label: "Seeded 42 rooms · arena is up on 5174",
            state: "done",
          },
        ],
      },
    ],
  },
  /*
   * Remembered: a project whose last tab closed. It keeps a header and has no
   * caret element in the markup at all — there is nothing to fold, so the
   * disclosure is omitted rather than disabled (DL-19.7). Its checkout prints
   * as a bare row, which in the app is that checkout's create control. Hovered,
   * so its close paints: this is the one place on the page it is said.
   */
  {
    project: "spacevibe-hub",
    remembered: true,
    hovered: true,
    checkouts: [{ name: "main", badge: { kind: "role", text: "Primary" }, panes: [] }],
  },
]);

/**
 * The stage side, held down.
 *
 * Three faint panes — the three the open card up in the rail is reporting on
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
