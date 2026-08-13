/**
 * Builds the app stage once, then paints a scene state onto it.
 *
 * The chrome comes from `marketing/stage/appwin.js` — the very renderers the
 * landing hero uses — so "does the video match the app?" reduces to "does the
 * landing stage match the app?", one question instead of two.
 */

import {
  renderStagePane,
  renderStageSidebar,
  renderStageStatus,
} from "../../stage/appwin.js";
import { BRAND, STAGE_ARIA_LABEL } from "../../stage/brand.js";
import { stagePanes, stageSidebar } from "../../stage/stage-data.js";
import { AGENTS, BOARD_ROWS, BOOT_LINES, PRESET_CELLS } from "./copy.js";
import { paneTranscriptAt } from "./transcript.js";

/** Attention colours — src/ui/agent-attention-mark.tsx precedence order. */
const ATTENTION_COLORS = Object.freeze({
  error: "#f7768e",
  warning: "#e0af68",
  requested: "#bb9af7",
  completed: "#9ece6a",
  none: null,
});

const paneById = new Map(stagePanes.map((pane) => [pane.id, pane]));

function renderAgentChip(agentId) {
  const agent = AGENTS[agentId];

  if (!agent) {
    throw new Error(`Unknown agent "${agentId}".`);
  }

  return `<span class="vid-chip" style="--chip-tint: ${agent.tint}">${agent.monogram}</span>`;
}

function renderPresetThumb(preset) {
  const cells = PRESET_CELLS[preset];

  if (!cells) {
    throw new Error(`Unknown layout preset "${preset}".`);
  }

  return `<span class="vid-thumb" data-preset="${preset}">${"<i></i>".repeat(cells)}</span>`;
}

function renderBoardRow(row) {
  return `
    <div class="vid-recent${row.hot ? " is-hot" : ""}" data-row="${row.id}">
      ${renderPresetThumb(row.preset)}
      <span class="vid-rectext">
        <strong>${row.label}</strong>
        <span>${row.path}</span>
      </span>
      <span class="vid-recagents">${row.agents.map(renderAgentChip).join("")}</span>
      ${row.hot ? '<kbd class="vid-openkbd" data-enter-key>↵ Open</kbd>' : ""}
    </div>
  `;
}

function renderBoard() {
  return `
    <div class="vid-board" data-board>
      <div class="vid-boardlogo">
        <img src="${BRAND.iconSrc}" alt="" />
        <span>${BRAND.name}</span>
      </div>
      <div class="vid-recents">${BOARD_ROWS.map(renderBoardRow).join("")}</div>
    </div>
  `;
}

function renderGrid() {
  const [claude, codex, opencode] = stagePanes;

  return `
    <div class="a-appwin__grid vid-grid" data-grid>
      <div class="a-appwin__col" data-col="left">
        ${renderStagePane({ ...claude, focused: false })}
      </div>
      <div class="a-appwin__col" data-col="right">
        ${renderStagePane({ ...codex, focused: false })}
        ${renderStagePane({ ...opencode, focused: false })}
      </div>
    </div>
  `;
}

function renderMarkup() {
  // Every avatar gets the wrapper so the sidebar never reflows when a status
  // appears mid-shot; "idle" is deliberately unstyled.
  const sidebarStatus = Object.fromEntries(
    stageSidebar.map((item) => [
      item.id,
      item.active ? "none" : item.id === "spacevibe-arena" ? "unread" : "idle",
    ]),
  );

  return `
    <figure class="a-appwin vid-appwin" role="img" aria-label="${STAGE_ARIA_LABEL}">
      <div class="a-appwin__body" aria-hidden="true">
        ${renderStageSidebar(sidebarStatus)}
        <div class="vid-scene">
          ${renderBoard()}
          ${renderGrid()}
        </div>
      </div>
      ${renderStageStatus()}
    </figure>
  `;
}

function collectRefs(root) {
  const grid = root.querySelector("[data-grid]");
  const board = root.querySelector("[data-board]");
  const enterKey = root.querySelector("[data-enter-key]");
  const hotRow = root.querySelector(".vid-recent.is-hot");
  const avatar = root.querySelector(`[data-ws-avatar="${BRAND.slug}"]`);

  if (!grid || !board || !enterKey || !hotRow || !avatar) {
    throw new Error("Video stage markup is incomplete.");
  }

  const panes = new Map();

  for (const pane of stagePanes) {
    const el = root.querySelector(`[data-pane="${pane.id}"]`);
    const lines = el?.querySelector("[data-lines]");
    const spinner = el?.querySelector("[data-spinner]");

    if (!el || !lines || !spinner) {
      throw new Error(`Video stage pane "${pane.id}" is incomplete.`);
    }

    panes.set(pane.id, { el, lines, spinner, signature: "" });
  }

  return { grid, board, enterKey, hotRow, avatar, panes };
}

function paintTranscript(ref, pane, timeMs) {
  const { lines, spinner } = paneTranscriptAt(
    pane,
    timeMs,
    BOOT_LINES[pane.id] ?? [],
  );
  const signature = `${lines.length}|${lines[lines.length - 1]?.text ?? ""}|${spinner ?? ""}`;

  if (signature === ref.signature) {
    return;
  }

  ref.signature = signature;
  ref.lines.replaceChildren(
    ...lines.map((line) => {
      const el = document.createElement("div");
      el.className = `a-appwin__line${line.cls ? ` ${line.cls}` : ""}`;
      el.textContent = line.text;

      return el;
    }),
  );

  ref.spinner.hidden = spinner === null;
  ref.spinner.textContent = spinner ?? "";
}

/**
 * Mount the stage inside `host` and return its painter.
 *
 * @param {HTMLElement} host
 */
export function createStage(host) {
  if (!host) {
    throw new Error("Stage host is missing.");
  }

  host.innerHTML = renderMarkup();

  const root = host.querySelector(".vid-appwin");

  if (!root) {
    throw new Error("Stage window failed to render.");
  }

  const refs = collectRefs(root);

  return {
    root,
    /** @param {ReturnType<import("./script.js").sceneStateAt>} state */
    apply(state) {
      const { board, grid, panes, avatar, hotRow, enterKey } = refs;

      root.style.opacity = String(state.window.opacity);

      board.style.opacity = String(state.board.opacity);
      board.style.transform = `scale(${state.board.scale})`;
      board.style.visibility = state.board.opacity <= 0.001 ? "hidden" : "";
      hotRow.style.setProperty("--hot", String(state.board.hot));
      enterKey.style.setProperty("--press", String(state.board.enterPulse));

      grid.style.opacity = String(state.grid.opacity);
      grid.style.transform = `scale(${state.grid.scale})`;
      grid.style.visibility = state.grid.opacity <= 0.001 ? "hidden" : "";
      grid.style.gridTemplateColumns = `${state.grid.splitLeft}fr ${state.grid.splitRight}fr`;

      for (const [id, ref] of panes) {
        const pane = paneById.get(id);
        const isFocused = state.focusedPane === id;
        const attention = ATTENTION_COLORS[state.attention[id] ?? "none"];

        ref.el.classList.toggle("is-focused", isFocused);
        ref.el.style.setProperty(
          "--ring",
          isFocused ? String(0.62 + state.focusRing * 0.38) : "0",
        );
        ref.el.style.setProperty("--att", attention ?? "transparent");
        ref.el.style.setProperty("--att-on", attention ? "1" : "0");

        if (id === "codex") {
          ref.el.style.flexGrow = String(state.grid.splitTop);
        }

        if (id === "opencode") {
          ref.el.style.flexGrow = String(state.grid.splitBottom);
        }

        paintTranscript(ref, pane, state.transcriptMs);
      }

      avatar.dataset.wsStatus = state.sidebarStatus;
    },
  };
}
