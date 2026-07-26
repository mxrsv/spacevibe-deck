/**
 * Shared app-window (".a-appwin") renderers — the mock of the real Deck
 * window. The landing hero, the scroll tour and the marketing video all
 * assemble the same chrome from here (styles live in direction-a.css).
 */

import { BRAND } from "./brand.js";
import { stageSidebar, stageStatus } from "./stage-data.js";

export const BRAND_ICON_SRC = BRAND.iconSrc;

export const STAGE_ICONS = {
  splitRow:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><line x1="12" y1="4.5" x2="12" y2="19.5"/>',
  splitColumn:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><line x1="3.5" y1="12" x2="20.5" y2="12"/>',
  closePane:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 9.5l5 5m0-5l-5 5"/>',
  expand:
    '<path d="M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v3"/><path d="M15 4.5h3a1.5 1.5 0 0 1 1.5 1.5v3"/><path d="M9 19.5H6A1.5 1.5 0 0 1 4.5 18v-3"/><path d="M15 19.5h3a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.08a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z"/>',
};

export function renderChromeIcon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export function renderStageTitlebar() {
  const icons = ["splitRow", "splitColumn", "closePane", "expand"]
    .map(
      (name) =>
        `<span class="a-appwin__iconbtn">${renderChromeIcon(STAGE_ICONS[name])}</span>`,
    )
    .join("");

  return `
    <div class="a-appwin__titlebar">
      <span class="a-appwin__lights"><i></i><i></i><i></i></span>
      <span class="a-appwin__actions">
        ${icons}
        <span class="a-appwin__actionsep"></span>
        <span class="a-appwin__iconbtn">${renderChromeIcon(STAGE_ICONS.gear)}</span>
      </span>
    </div>
  `;
}

/**
 * Workspace sidebar. `statusById` optionally decorates avatars with the
 * app's live indicators — "busy" (spinning agent ring) or "unread" (yellow
 * dot) — used by the tour; the hero passes nothing and stays as shipped.
 *
 * @param {Record<string, "busy" | "unread"> | undefined} statusById
 */
export function renderStageSidebar(statusById = undefined) {
  const items = stageSidebar
    .map((item) => {
      const status = statusById?.[item.id];
      const logo =
        item.monogram === null
          ? `<img class="a-appwin__wslogo" src="${BRAND_ICON_SRC}" alt="" />`
          : `<span class="a-appwin__wslogo a-appwin__wslogo--mono" style="--ws-tint: ${item.tint}">${item.monogram}</span>`;
      // Only wrap when a status is asked for: the bare <img> is a direct flex
      // child in the hero, and an unstyled wrapper would break that row.
      const avatar = status
        ? `<span class="a-appwin__wsavatar" data-ws-avatar="${item.id}" data-ws-status="${status}">${logo}</span>`
        : logo;

      return `
        <div class="a-appwin__wsitem${item.active ? " is-active" : ""}" data-ws-item="${item.id}">
          ${avatar}
          <span class="a-appwin__wstext">
            <span class="a-appwin__wslabel">${item.label}</span>
            <span class="a-appwin__wspath">${item.path}</span>
          </span>
          ${item.active ? '<span class="a-appwin__wsclose">×</span>' : ""}
        </div>
      `;
    })
    .join("");

  return `
    <aside class="a-appwin__sidebar">
      ${items}
      <div class="a-appwin__wsadd"><span>+</span>Open workspace</div>
    </aside>
  `;
}

export function renderStagePane(pane) {
  const footer = pane.footer
    .map(
      (line) =>
        `<span class="a-appwin__footline${line.cls ? ` ${line.cls}` : ""}">${line.text}</span>`,
    )
    .join("");

  return `
    <article class="a-appwin__pane${pane.focused ? " is-focused" : ""}" data-pane="${pane.id}">
      <div class="a-appwin__transcript" data-stream="${pane.id}">
        <div class="a-appwin__lines" data-lines></div>
        <div class="a-appwin__spinner" data-spinner hidden></div>
      </div>
      <div class="a-appwin__panefoot">
        <div class="a-appwin__promptbox">
          <span class="a-appwin__promptglyph">${pane.prompt}</span>
          <i class="a-appwin__cursor"></i>
        </div>
        ${footer}
      </div>
    </article>
  `;
}

export function renderStageStatus() {
  const hints = stageStatus.hints
    .map(
      (hint) =>
        `<span class="a-appwin__hint">${hint.label}</span><kbd class="a-appwin__kbd">${hint.key}</kbd>`,
    )
    .join("");

  return `
    <footer class="a-appwin__status">
      <span class="a-appwin__seg"><i class="a-appwin__gitdot"></i>${stageStatus.branch}</span>
      <span class="a-appwin__vsep"></span>
      <span class="a-appwin__seg a-appwin__seg--cwd">${stageStatus.cwd}</span>
      <span class="a-appwin__statusright">
        <span class="a-appwin__seg" data-status-panes>${stageStatus.paneCount}</span>
        <span class="a-appwin__vsep"></span>
        <span class="a-appwin__seg">${stageStatus.theme}</span>
        <span class="a-appwin__vsep"></span>
        <span class="a-appwin__seg">${hints}</span>
      </span>
    </footer>
  `;
}
