/**
 * Panel 4 — the surfaces a tab can be.
 *
 * The unified strip, the file tree and the editor, drawn as one window.
 */

import { frame, sceneAgentMark } from "./chrome.js";

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

export function surfaces() {
  const tabs = SURFACE_TABS.map((tab) => {
    const glyph =
      tab.kind === "agent"
        ? sceneAgentMark(tab.agent, "scene-surfaces__tabmark")
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
    { rail: null },
  );
}
