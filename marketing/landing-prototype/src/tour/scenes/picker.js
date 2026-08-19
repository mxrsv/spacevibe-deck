/**
 * Panel 2 — the quick picker.
 *
 * ⌘T over a dimmed stage: one destination row, then the agents as rows.
 */

import { AGENT_MARKS, renderAgentMark } from "../../agent-strip.js";
import { frame } from "./chrome.js";

export function picker() {
  const rows = AGENT_MARKS.map(
    (agent, index) => `
      <div class="scene-picker__row${index === 0 ? " is-active" : ""}">
        ${renderAgentMark(agent, "scene-picker__mark", 18)}
        <span class="scene-picker__label">${agent.label}</span>
        <kbd class="scene-picker__key">${index + 1}</kbd>
      </div>
    `,
  ).join("");

  return frame(`
    <div class="scene scene-picker">
      <div class="scene-picker__scrim"></div>
      <div class="scene-picker__panel">
        <div class="scene-picker__dest">
          <span class="scene-picker__destlabel">Open in</span>
          <span class="scene-picker__destvalue">
            <strong>deck-detach</strong>
            <span class="scene-picker__branch">feat/pane-detach</span>
          </span>
          <span class="scene-picker__caret">⌄</span>
        </div>
        <div class="scene-picker__rows">${rows}</div>
      </div>
    </div>
  `);
}
