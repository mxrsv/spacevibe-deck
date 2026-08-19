/**
 * The window mocks the feature panels stand on.
 *
 * The tour's single morphing window could only ever tell the three beats the
 * 16-second reel already tells. These are purpose-built drawings, one per
 * feature, in the same `.a-appwin` chrome as the hero stage — a scene is a
 * BODY for that chrome, never a new window.
 *
 * Everything here is a drawing of the real product, not a screenshot of it:
 * the class names are the landing's own (`scene-*`), sized in `cqw` against
 * the window's container so a scene scales with the panel it sits in, exactly
 * as the terminal panes do.
 */

import { AGENT_MARKS } from "../agent-strip.js";
import { renderStageSidebar, renderStageStatus } from "../appwin.js";
import { STAGE_ARIA_LABEL } from "../product-stage.js";
import { SIDEBAR_STATUS } from "./stage-states.js";

const MARK_BY_ID = Object.fromEntries(
  AGENT_MARKS.map((agent) => [agent.id, agent]),
);

function agentMark(id, className) {
  const agent = MARK_BY_ID[id];

  return `<img class="${className}" src="${agent.mark}" alt="" width="18" height="18" />`;
}

/** Wraps a scene body in the shared window chrome. */
function frame(body, { sidebar = true } = {}) {
  return `
    <figure class="a-appwin tour__appwin" role="img" aria-label="${STAGE_ARIA_LABEL}">
      <div class="a-appwin__body" aria-hidden="true">
        ${sidebar ? renderStageSidebar(SIDEBAR_STATUS) : ""}
        ${body}
      </div>
      ${renderStageStatus()}
    </figure>
  `;
}

/* ---------------------------------------------------------------- restore */

/**
 * Three panes, each typing the resume command its own CLI takes. The commands
 * are the real ones — `src/lib/agent-resume.ts`'s COMMAND_TABLE — because a
 * made-up flag is the kind of detail the people this page is for will check.
 */
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
        ${agentMark(pane.agent, "scene-restore__mark")}
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

export function renderRestoreScene() {
  return frame(`
    <div class="scene scene-restore">
      <div class="scene-restore__panes">
        ${RESTORE_PANES.map(renderRestorePane).join("")}
      </div>
    </div>
  `);
}

/* ------------------------------------------------------------------- rail */

/**
 * The rail with every row carrying its agent's newest turn. Shape mirrors
 * `src/ui/agent-rail.tsx`: a cluster per project, one leaf per pane, the
 * sentence where the agent name would otherwise repeat.
 */
const RAIL_PROJECTS = [
  {
    name: "deck",
    branch: "main",
    panes: [
      {
        agent: "claude",
        message: "214 tests passed — the divider stays put now.",
        age: "2m",
        state: "ok",
      },
      {
        agent: "codex",
        message: "I'll trace why the pane divider drifts on resize.",
        age: "12s",
        state: "working",
      },
    ],
  },
  {
    name: "spacevibe-api",
    branch: "feat/usage",
    panes: [
      {
        agent: "opencode",
        message: "Migration applied — 4 tables changed.",
        age: "5m",
        state: "ok",
      },
    ],
  },
  {
    name: "spacevibe-arena",
    branch: "main",
    panes: [
      {
        agent: "claude",
        message: "Which environment should the seed point at?",
        age: "now",
        state: "asked",
      },
    ],
  },
];

function renderRailPane(pane, order) {
  return `
    <div
      class="scene-rail__leaf"
      data-state="${pane.state}"
      data-rail-leaf
      style="--scene-delay: ${240 + order * 180}ms"
    >
      ${agentMark(pane.agent, "scene-rail__mark")}
      <span class="scene-rail__msg">${pane.message}</span>
      <span class="scene-rail__age">${pane.age}</span>
    </div>
  `;
}

export function renderRailScene() {
  let order = 0;
  const projects = RAIL_PROJECTS.map((project) => {
    const panes = project.panes
      .map((pane) => {
        order += 1;
        return renderRailPane(pane, order);
      })
      .join("");

    return `
      <div class="scene-rail__project">
        <div class="scene-rail__head">
          <span class="scene-rail__name">${project.name}</span>
          <span class="scene-rail__branch">${project.branch}</span>
        </div>
        ${panes}
      </div>
    `;
  }).join("");

  // The quiet tail of the real rail: workspaces that are closed but whose
  // sessions are still on disk, one click from resuming.
  const archived = ["spacevibe-hub", "spacevibe-academy"]
    .map(
      (name, index) => `
        <div
          class="scene-rail__archived"
          style="--scene-delay: ${900 + index * 140}ms"
        >
          <span class="scene-rail__archname">${name}</span>
          <span class="scene-rail__archhint">resume</span>
        </div>
      `,
    )
    .join("");

  return frame(
    `
      <div class="scene scene-rail">
        <div class="scene-rail__list">
          ${projects}
          <div class="scene-rail__spacer"></div>
          <div class="scene-rail__archive">${archived}</div>
        </div>
        <div class="scene-rail__stage" aria-hidden="true">
          <span class="scene-rail__stagehint">the panes keep running</span>
        </div>
      </div>
    `,
    { sidebar: false },
  );
}

/* ----------------------------------------------------------------- picker */

/** ⌘T over a dimmed stage: one destination row, then the agents as rows. */
export function renderPickerScene() {
  const rows = AGENT_MARKS.map(
    (agent, index) => `
      <div class="scene-picker__row${index === 0 ? " is-active" : ""}">
        <img class="scene-picker__mark" src="${agent.mark}" alt="" width="18" height="18" />
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

/* --------------------------------------------------------------- surfaces */

const SURFACE_TABS = [
  { kind: "agent", agent: "claude", label: "claude", active: false },
  { kind: "file", label: "layout-engine.ts", active: true },
  { kind: "browser", label: "localhost:5173", active: false },
];

const EDITOR_LINES = [
  {
    n: 68,
    text: "export function splitRatio(next, total, columns) {",
    cls: "",
  },
  {
    n: 69,
    text: "  // A divider drags in pixels; the grid stores a",
    cls: "t-dim",
  },
  {
    n: 70,
    text: "  // fraction, so the rounding happens once, here.",
    cls: "t-dim",
  },
  { n: 71, text: "  const ratio = clamp(next / total, MIN, MAX);", cls: "" },
  { n: 72, text: "  const cells = Math.round(ratio * columns);", cls: "" },
  { n: 73, text: "", cls: "" },
  { n: 74, text: "  if (cells === 0 || cells === columns) {", cls: "" },
  { n: 75, text: "    return { cells: clampCells(cells), ratio };", cls: "" },
  { n: 76, text: "  }", cls: "" },
  { n: 77, text: "", cls: "" },
  { n: 78, text: "  return { cells, ratio };", cls: "" },
  { n: 79, text: "}", cls: "" },
];

const FILE_TREE = [
  { name: "src", kind: "dir", depth: 0 },
  { name: "terminal", kind: "dir", depth: 1 },
  { name: "layout-engine.ts", kind: "file", depth: 2, active: true },
  { name: "pane-lifecycle.ts", kind: "file", depth: 2 },
  { name: "tabs-store.ts", kind: "file", depth: 2 },
  { name: "session-journal.ts", kind: "file", depth: 2 },
  { name: "lib", kind: "dir", depth: 1 },
  { name: "agent-catalog.ts", kind: "file", depth: 2 },
  { name: "agent-resume.ts", kind: "file", depth: 2 },
  { name: "ui", kind: "dir", depth: 1 },
];

export function renderSurfacesScene() {
  const tabs = SURFACE_TABS.map((tab) => {
    const glyph =
      tab.kind === "agent"
        ? agentMark(tab.agent, "scene-surfaces__tabmark")
        : `<span class="scene-surfaces__tabglyph">${tab.kind === "file" ? "TS" : "◍"}</span>`;

    return `
      <span class="scene-surfaces__tab${tab.active ? " is-active" : ""}">
        ${glyph}
        <span>${tab.label}</span>
      </span>
    `;
  }).join("");

  const tree = FILE_TREE.map(
    (node) => `
      <div
        class="scene-surfaces__node${node.active ? " is-active" : ""}"
        data-kind="${node.kind}"
        style="--depth: ${node.depth}"
      >${node.name}</div>
    `,
  ).join("");

  const code = EDITOR_LINES.map(
    (line) => `
      <div class="scene-surfaces__line ${line.cls}">
        <span class="scene-surfaces__num">${line.n}</span>
        <span>${line.text}</span>
      </div>
    `,
  ).join("");

  return frame(
    `
      <div class="scene scene-surfaces">
        <div class="scene-surfaces__strip">${tabs}</div>
        <div class="scene-surfaces__work">
          <div class="scene-surfaces__tree">${tree}</div>
          <div class="scene-surfaces__pane">
            <div class="scene-surfaces__editor">${code}</div>
            <div class="scene-surfaces__bar">
              <span>src/terminal/layout-engine.ts</span>
              <span class="scene-surfaces__dirty">unsaved · ⌘S</span>
            </div>
          </div>
        </div>
      </div>
    `,
    { sidebar: false },
  );
}

export const SCENES = {
  restore: renderRestoreScene,
  rail: renderRailScene,
  picker: renderPickerScene,
  surfaces: renderSurfacesScene,
};
