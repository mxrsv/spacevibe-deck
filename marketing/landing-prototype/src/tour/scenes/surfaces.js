/**
 * Panel 4 — the surfaces a tab can be.
 *
 * One strip carries a terminal, a document and a browser, and it is the hero's
 * own `renderStageStrip` rather than a shape drawn twice: a reader who has
 * already met the chip at the top of the page meets the same chip here, and a
 * later change to the app's strip reaches both places at once.
 *
 * The beat this panel exists for is the ⌘+click (DL-14.7, 2026-08-20). An
 * agent prints a path; a path inside a workspace this window already has open
 * lands in Deck's OWN editor as a preview tab, revealed at its line. So the
 * transcript's path is a link and the editor stands open at the line it names.
 * The external-app split button is deliberately absent — routing a path to
 * another app is Electron-only and a different beat.
 *
 * `TARGET_PATH` and `TARGET_LINE` feed the link, the editor's marked row and
 * the file's status line, so none of the three can drift from the others:
 * there is one path and one number in this file, not four.
 */

import { frame } from "./chrome.js";

/** The path the agent prints, and the row the editor opens at. */
const TARGET_PATH = "src/terminal/layout-engine.ts";
const TARGET_LINE = 214;

/**
 * The three chips, in the strip's own shape.
 *
 * The document chip is the active one, and its label is italic because a
 * ⌘+click opens a PREVIEW tab and the app italicises a preview label
 * (`tab-strip.tsx:212`, `.tab__label--preview`). The italic is the visible
 * half of a promise the status line makes below it: nothing has been typed
 * into this document, and the first edit is what would promote the tab.
 *
 * Every `paneId` is null. A panel scene mounts no stream, so a `data-tail`
 * hook here would be a hook that lies about being live — the rule `SCENE_RAIL`
 * follows with its own null pane ids.
 */
const SURFACE_STRIP = [
  {
    kind: "terminal",
    agent: "claude",
    paneId: null,
    label: "claude",
    active: false,
  },
  {
    kind: "file",
    paneId: null,
    label: '<i class="scene-surfaces__preview">layout-engine.ts</i>',
    active: true,
  },
  {
    kind: "browser",
    paneId: null,
    label: "localhost:5173",
    active: false,
  },
];

/**
 * What the agent said, and the tool call that names the line.
 *
 * Claude Code marks both its prose and its tool calls with the same bullet, so
 * both rows carry one. The weighting is the panel's, not the CLI's: the lead
 * is dimmed and the `Update` row is not, because the path in that row is the
 * subject of the whole drawing.
 *
 * The sentence describes the line the link points at — 214 is the guard that
 * clamps a drag before it can zero a pane — so a reader who follows the link
 * with their eye finds the code the sentence promised.
 */
const TRANSCRIPT_LEAD =
  "Added the collapse guard — a drag can no longer empty a pane.";

const EDITOR_LINES = [
  {
    n: 208,
    text: "export function splitRatio(next, total, columns) {",
    cls: "",
  },
  {
    n: 209,
    text: "  // A divider drags in pixels; the grid stores a",
    cls: "t-dim",
  },
  {
    n: 210,
    text: "  // fraction, so the rounding happens once, here.",
    cls: "t-dim",
  },
  { n: 211, text: "  const ratio = clamp(next / total, MIN, MAX);", cls: "" },
  { n: 212, text: "  const cells = Math.round(ratio * columns);", cls: "" },
  { n: 213, text: "", cls: "" },
  { n: 214, text: "  if (cells === 0 || cells === columns) {", cls: "" },
  { n: 215, text: "    return { cells: clampCells(cells), ratio };", cls: "" },
  { n: 216, text: "  }", cls: "" },
  { n: 217, text: "", cls: "" },
  { n: 218, text: "  return { cells, ratio };", cls: "" },
  { n: 219, text: "}", cls: "" },
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
  const tree = FILE_TREE.map(
    (node) => `
      <div
        class="scene-surfaces__node${node.active ? " is-active" : ""}"
        data-kind="${node.kind}"
        style="--depth: ${node.depth}"
      >${node.name}</div>
    `,
  ).join("");

  const code = EDITOR_LINES.map((line) => {
    const classes = ["scene-surfaces__line", line.cls]
      .concat(line.n === TARGET_LINE ? "is-target" : [])
      .filter(Boolean)
      .join(" ");

    return `
      <div class="${classes}">
        <span class="scene-surfaces__num">${line.n}</span>
        <span>${line.text}</span>
      </div>
    `;
  }).join("");

  return frame(
    `
      <div class="scene scene-surfaces">
        <div class="scene-surfaces__work">
          <div class="scene-surfaces__tree">${tree}</div>
          <div class="scene-surfaces__pane">
            <div class="scene-surfaces__transcript">
              <div class="scene-surfaces__trow t-dim">
                <span class="scene-surfaces__bullet">●</span>
                <span>${TRANSCRIPT_LEAD}</span>
              </div>
              <div class="scene-surfaces__trow">
                <span class="scene-surfaces__bullet">●</span>
                <span>Update(<span class="scene-surfaces__link">${TARGET_PATH}:${TARGET_LINE}</span>)</span>
                <kbd class="scene-surfaces__key">⌘</kbd>
              </div>
            </div>
            <div class="scene-surfaces__editor">${code}</div>
            <div class="scene-surfaces__bar">
              <span>${TARGET_PATH}:${TARGET_LINE}</span>
              <span class="scene-surfaces__state">preview · ⌘S saves</span>
            </div>
          </div>
        </div>
      </div>
    `,
    { rail: null, strip: SURFACE_STRIP },
  );
}
