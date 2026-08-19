/**
 * Panel 1 — the agent rail.
 *
 * The rail with every row carrying its agent's newest turn. Shape mirrors
 * `src/ui/agent-rail.tsx`: a cluster per project, one leaf per pane, the
 * sentence where the agent name would otherwise repeat.
 */

import { frame, sceneAgentMark } from "./chrome.js";

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
      ${sceneAgentMark(pane.agent, "scene-rail__mark")}
      <span class="scene-rail__msg">${pane.message}</span>
      <span class="scene-rail__age">${pane.age}</span>
    </div>
  `;
}

export function rail() {
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
    { rail: null },
  );
}
