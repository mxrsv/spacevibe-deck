/**
 * Panel 3 — session restore.
 *
 * Three panes, each typing the resume command its own CLI takes. The commands
 * are the real ones — `src/lib/agent-resume.ts`'s COMMAND_TABLE — because a
 * made-up flag is the kind of detail the people this page is for will check.
 *
 * All three are the table's ID forms, which is what a restore of a KNOWN
 * session types. Two of those are easy to get wrong in opposite directions:
 * claude's id form is `claude --resume <id>` and carries NO permission-skipping
 * flag — that one belongs to the agent catalog's *launch* command, never to
 * the resume table — and codex's is `codex resume <id>`, where `codex resume
 * --last` is the *latest* form, asking for whatever ran last rather than for
 * the session this panel is restoring.
 */

import { SCENE_RAIL, frame, sceneAgentMark } from "./chrome.js";

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
    cmd: "codex resume 019a4f1c",
    lines: [
      { text: "Restored — session 019a4f1c.", cls: "t-dim" },
      { text: "96 passed · 0 failed from the last run.", cls: "t-ok" },
    ],
    foot: "session 019a4f1c · gpt-5-codex",
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

/**
 * The tab strip: one chip per restored tab, in the order restore reopened
 * them.
 *
 * This is the half of the panel's own claim that the body cannot draw. The
 * copy says Deck brings back "every tab and pane"; the three columns below are
 * the panes, and the strip is where the tabs get said.
 *
 * A chip's label is its tab's newest turn rather than its agent's name, which
 * is `tabTail`'s precedence in the app (AGENTS.md, 2026-08-17). It is read off
 * `RESTORE_PANES`' last transcript line instead of written a second time, so a
 * chip cannot drift from the transcript standing under it.
 *
 * Every `paneId` is null. A panel scene mounts no stream, so a `data-tail`
 * hook here would be a hook that lies about being live — the same rule
 * `SCENE_RAIL` follows with its null pane ids.
 */
const RESTORE_STRIP = RESTORE_PANES.map((pane, index) => ({
  kind: "terminal",
  agent: pane.agent,
  paneId: null,
  label: pane.lines[pane.lines.length - 1].text,
  active: index === 0,
}));

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
  return frame(
    `
    <div class="scene scene-restore">
      <div class="scene-restore__panes">
        ${RESTORE_PANES.map(renderRestorePane).join("")}
      </div>
    </div>
  `,
    { rail: SCENE_RAIL, strip: RESTORE_STRIP },
  );
}
