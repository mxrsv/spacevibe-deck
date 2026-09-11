/**
 * Panel 2 — ⌘T's New Agent list.
 *
 * Deck 1.1 retired the quick picker. ⌘T now raises the checkout card's own
 * actions menu FREE-STANDING (`worktree-card-menus.tsx`, placement
 * `free-standing`; `docs/internals/agent-rail.md`, "One create control per
 * checkout"): it hangs under the stage strip at its leading edge, names the
 * checkout the agent will run in on one heading line, lists the agents, then
 * `New split here`, `Open in Finder` and `Open another project…`, and closes
 * on the scope line. It is a popover, not a modal, so there is no scrim.
 *
 * The rows are the ones the SHIPPED app wires (`railCardActions` in
 * `app.tsx`), not every row the component can draw: `Create branch from here`
 * is unwired while Quick Launch is deferred and `Open terminal here` has no
 * caller, so both are omitted — DL-19.7, a control nothing answers is not
 * drawn.
 *
 * The checkout is the rail's active card, `detach` on
 * `feat/detach`, so the heading reads project · folder · branch —
 * `whereOf`'s own words.
 */

import { STAGE_ICONS, renderChromeIcon } from "../../appwin.js";
import { deepFreeze } from "../../product-stage.js";
import { INSTALLED, launchCommand } from "./catalog.js";
import { frame, sceneAgentMark } from "./chrome.js";

/** `subjectWhere` for the active card: nothing in it repeats, so nothing drops. */
const WHERE = "spacevibe-deck · detach · feat/detach";

/*
 * The rail behind the menu: the hero's project, both checkouts CLOSED, and
 * `detach` holding the window's focus — the checkout ⌘T's list is about.
 * Every `id` is null: a panel mounts no stream.
 */
const MENU_RAIL = deepFreeze([
  {
    project: "spacevibe-deck",
    checkouts: [
      {
        name: "main",
        badge: { kind: "role", text: "Primary" },
        age: "now",
        panes: [
          {
            id: null,
            agent: "claude",
            label: "I'll trace why the pane divider drifts on resize.",
            state: "working",
          },
          { id: null, agent: "codex", label: "96 passed · 0 failed", state: "done" },
          {
            id: null,
            agent: "opencode",
            label: "typecheck clean · the branch follows cwd now",
            state: "done",
          },
        ],
      },
      {
        name: "detach",
        badge: { kind: "branch", text: "feat/detach" },
        age: "1m",
        active: true,
        panes: [
          {
            id: null,
            agent: "codex",
            label: "Moving the pane's PTY into the new window.",
            state: "working",
          },
        ],
      },
    ],
  },
]);

/* The strip shows the active repository's tabs; the focused one is the
   worktree's. No `paneId`: nothing streams into a panel. */
const MENU_STRIP = deepFreeze([
  {
    kind: "terminal",
    agent: "claude",
    paneId: null,
    label: "I'll trace why the pane divider drifts on resize.",
    active: false,
  },
  {
    kind: "terminal",
    agent: "codex",
    paneId: null,
    label: "Moving the pane's PTY into the new window.",
    active: true,
  },
]);

/*
 * The action glyphs (`ACTION_GLYPHS`), drawn for one 24-grid
 * `renderChromeIcon` box: SquareHalf for the split — one pane divided —
 * FolderOpen for Finder, FolderPlus for another project, and the footer's
 * Info ring.
 */
const MENU_ICONS = {
  split:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15"/><path d="M12 4.5h6.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H12Z" fill="currentColor" fill-opacity="0.35" stroke="none"/>',
  finder:
    '<path d="M3.5 18.5V6A1.5 1.5 0 0 1 5 4.5h4.2l2 2H18A1.5 1.5 0 0 1 19.5 8v2"/><path d="M3.5 18.5l2.6-7.2A1.5 1.5 0 0 1 7.5 10.3h13a1 1 0 0 1 .95 1.3L19 18.5Z"/>',
  board: `${STAGE_ICONS.folder}<path d="M12 10.5v6M9 13.5h6"/>`,
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="7.9" r="0.7" fill="currentColor" stroke="none"/>',
};

/*
 * The groups in `actionGroups`' order — agents, work, the OS, the board —
 * each separated by a hairline. An agent row's detail is the command it will
 * run: no model is stored for any of the three, so that is the fact the app
 * prints. The agents are panel 6's installed three, commands and all.
 */
const MENU_GROUPS = [
  INSTALLED.map((agent) => ({ agent: agent.id, title: agent.label, detail: launchCommand(agent) })),
  [{ glyph: "split", title: "New split here", detail: "Open a pane beside this tab" }],
  [{ glyph: "finder", title: "Open in Finder", detail: "Reveal this folder" }],
  [{ glyph: "board", title: "Open another project…", detail: "Add a folder or worktree" }],
];

function renderMenuRow(row, focused) {
  const glyph =
    row.agent === undefined
      ? renderChromeIcon(MENU_ICONS[row.glyph])
      : sceneAgentMark(row.agent, "scene-menu__logo", 15);

  return `
        <div class="scene-menu__row${focused ? " is-focused" : ""}">
          <span class="scene-menu__glyph">${glyph}</span>
          <span class="scene-menu__title">${row.title}</span>
          <span class="scene-menu__detail">${row.detail}</span>
        </div>
      `;
}

function menuBody() {
  const groups = MENU_GROUPS.map((rows, group) =>
    rows.map((row, index) => renderMenuRow(row, group === 0 && index === 0)).join(""),
  ).join('<div class="scene-menu__sep"></div>');

  return `
    <div class="scene scene-menu">
      <div class="scene-menu__panes">
        <span class="scene-menu__pane"></span>
        <span class="scene-menu__pane"></span>
      </div>
      <div class="scene-menu__pop">
        <p class="scene-menu__where">${WHERE}</p>
        ${groups}
        <div class="scene-menu__sep"></div>
        <p class="scene-menu__foot">${renderChromeIcon(MENU_ICONS.info)}<span>Everything here runs in this checkout</span></p>
      </div>
    </div>
  `;
}

export function menu() {
  return frame(menuBody(), { rail: MENU_RAIL, strip: MENU_STRIP });
}
