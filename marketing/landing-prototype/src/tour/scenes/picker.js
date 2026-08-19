/**
 * Panel 2 — the ⌘T quick picker.
 *
 * ⌘T over a dimmed stage: one destination row, then the agents as rows.
 * Drawn from src/ui/agent-quick-picker.tsx and styles/10-modals.css — the
 * panel is 420px of --sidebar-bg inside a 42% scrim, the destination is a
 * MENU value rather than a text field, and the agents are a COLUMN, because
 * the picker overrides the open board's wrapped .agents grid.
 *
 * Two things this drawing states that the shipped panel does not:
 *
 *   1. Every row carries its digit. The app took those badges off the chips
 *      on 2026-08-16 and kept the keys working; the tour is teaching the
 *      keyboard, so the mock puts the number back where the key line points.
 *   2. The shell row is drawn. The spec did not ask for it, but the key line
 *      says "0 shell" verbatim, and a key line naming a row that is not on
 *      screen is a lie about the panel.
 *
 * No row is drawn selected: focus starts on the PANEL and never on a row
 * (agent-quick-picker.tsx:162-167, modal.tsx:126-128), so a highlighted first
 * row would contradict the ↑↓ the key line teaches.
 */

import { AGENT_MARKS, renderAgentMark } from "../../agent-strip.js";
import { renderChromeIcon } from "../../appwin.js";
import { frame } from "./chrome.js";

/*
 * CaretDown — the destination row's menu hint (ROW_ICON, 14px in the app).
 * STAGE_ICONS carries a `caret`, but that one is CaretRight: it is the
 * cluster header's collapse affordance and points the wrong way here. Same
 * Phosphor geometry turned a quarter, so it still renders through the shared
 * renderChromeIcon box and inherits the same stroke and currentColor.
 */
const CARET_DOWN = '<path d="M5.25 9L12 15.75 18.75 9"/>';

/*
 * The three agents this imaginary machine actually has on $PATH.
 *
 * Panel 6 counts "3 detected / 3 agents" off the same catalog, so a picker
 * offering all six freely would make the two panels disagree about one
 * machine. The undetected three are drawn in the app's own missing state —
 * dashed edge, faint ink — which is the row that opens Settings rather than
 * launching (agent-quick-picker.tsx:151-160). The split is exactly T16's
 * Installed / Available to install groups.
 */
const DETECTED_AGENTS = new Set(["claude", "codex", "opencode"]);

/*
 * A worktree of the project the rail behind the scrim is showing, so the
 * destination is somewhere this window could actually open. `folder · branch`
 * with a MIDDLE DOT and spaces on both sides is destinationLabel's own
 * format (src/repositories/worktree-destinations.ts:79-83) — one value, not a
 * folder field beside a branch field, because git makes a worktree and its
 * branch a single choice.
 */
const DESTINATION = "deck-detach · feat/pane-detach";

/*
 * The key line, verbatim from agent-quick-picker.tsx:359-362.
 *
 * Byte-exact and deliberately hoisted out of the markup so a reflow cannot
 * quietly rewrite it: the dash between 1 and 9 is an EN DASH (U+2013), not a
 * hyphen, and there are THREE middle dots (U+00B7) — after "pick", after
 * "shell" and after "Enter", not four. The arrows are U+2191 and U+2193.
 *
 * The tone inverts here: the line itself is --text-faint and the kbds inside
 * it are ONE STEP BRIGHTER at --text-muted (10-modals.css:306-314), which is
 * --sg-fg-faint and --sg-fg-dim on this page.
 */
const KEY_HINT =
  "<kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>0</kbd> shell · <kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd> · <kbd>Esc</kbd> close";

/**
 * One agent row: mark, label, digit.
 *
 * The list is AGENT_MARKS in BUILTIN_AGENTS order, and the order is the
 * digit-key contract — `cursor-agent` is last, so it is row 6, and it is the
 * one agent with no brand file, which renderAgentMark answers with a
 * monogram instead of a broken image.
 *
 * @param {{ id: string, label: string, mark: string | null }} agent
 * @param {number} index position in the catalog, one below its digit
 */
function renderPickerRow(agent, index) {
  const missing = DETECTED_AGENTS.has(agent.id) ? "" : " is-missing";

  return `
    <div class="scene-picker__row${missing}">
      ${renderAgentMark(agent, "scene-picker__mark", 18)}
      <span class="scene-picker__label">${agent.label}</span>
      <kbd class="scene-picker__digit">${index + 1}</kbd>
    </div>
  `;
}

export function picker() {
  const rows = AGENT_MARKS.map(renderPickerRow).join("");

  return frame(`
    <div class="scene scene-picker">
      <div class="scene-picker__scrim"></div>
      <div class="scene-picker__panel">
        <p class="scene-picker__title">Open a new tab</p>
        <div class="scene-picker__dest">
          <span class="scene-picker__destlabel">Worktree</span>
          <span class="scene-picker__destvalue">
            <span class="scene-picker__desttext">${DESTINATION}</span>
            <span class="scene-picker__caret">${renderChromeIcon(CARET_DOWN)}</span>
          </span>
        </div>
        <div class="scene-picker__rows">
          ${rows}
          <div class="scene-picker__row is-shell">
            <span class="scene-picker__mark scene-picker__mark--shell">$</span>
            <span class="scene-picker__label">Shell only</span>
            <kbd class="scene-picker__digit">0</kbd>
          </div>
        </div>
        <p class="scene-picker__keys">${KEY_HINT}</p>
      </div>
    </div>
  `);
}
