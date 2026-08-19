/**
 * Panel 3 — session restore.
 *
 * Three panes, each typing the resume command its own CLI takes. The commands
 * are the real ones — `src/lib/agent-resume.ts`'s COMMAND_TABLE — because a
 * made-up flag is the kind of detail the people this page is for will check.
 */

import { frame, sceneAgentMark } from "./chrome.js";

const RESTORE_PANES = [
  {
    agent: "claude",
    cmd: "claude --resume 0f3a91c2",
    lines: [
      { text: "Restored — 41 messages of context.", cls: "t-dim" },
      {
        text: "Still open: the pane divider drifts on resize.",
        cls: "t-agent",
      },
    ],
    foot: "41 messages restored · claude-opus-5",
  },
  {
    agent: "codex",
    cmd: "codex resume --last",
    lines: [
      { text: "Restored — session 8d41f0.", cls: "t-dim" },
      { text: "96 passed · 0 failed from the last run.", cls: "t-ok" },
    ],
    foot: "session 8d41f0 · gpt-5-codex",
  },
  {
    agent: "opencode",
    cmd: "opencode -s 3b77ae",
    lines: [
      { text: "Restored — 12.4k tokens of context.", cls: "t-dim" },
      { text: "Waiting on your next instruction.", cls: "t-body" },
    ],
    foot: "12.4k tokens · claude-sonnet-5",
  },
];

function renderRestorePane(pane, index) {
  const lines = pane.lines
    .map(
      (line, lineIndex) => `
        <span
          class="scene-restore__line ${line.cls}"
          data-restore-line
          style="--scene-delay: ${520 + index * 260 + lineIndex * 220}ms"
        >${line.text}</span>
      `,
    )
    .join("");

  return `
    <div class="scene-restore__pane">
      <div class="scene-restore__head">
        ${sceneAgentMark(pane.agent, "scene-restore__mark")}
        <span class="scene-restore__agent">${pane.agent}</span>
        <span class="scene-restore__badge">restored</span>
      </div>
      <div class="scene-restore__cmd">
        <span class="scene-restore__prompt">❯</span>
        <span
          class="scene-restore__typed"
          data-restore-type
          style="--scene-delay: ${index * 220}ms; --scene-steps: ${pane.cmd.length}"
        >${pane.cmd}</span>
      </div>
      <div class="scene-restore__out">${lines}</div>
      <div class="scene-restore__spacer"></div>
      <div class="a-appwin__promptbox">
        <span class="a-appwin__cursor"></span>
      </div>
      <span class="scene-restore__foot">${pane.foot}</span>
    </div>
  `;
}

export function restore() {
  return frame(`
    <div class="scene scene-restore">
      <div class="scene-restore__panes">
        ${RESTORE_PANES.map(renderRestorePane).join("")}
      </div>
    </div>
  `);
}
