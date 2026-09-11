/**
 * The hero's recolour beat: the drawn pointer right-clicks the active
 * checkout card, opens `Worktree color` in the card's actions menu and picks
 * a swatch, and the card's frame, mark and badge take the colour — the app's
 * `WorktreeColorPicker` (DL-27.25), drawn. Owner-asked 2026-09-11.
 *
 * The menu is the ANCHORED card menu: the ⌘T list's rows without its `where`
 * heading, then the colour row the free-standing list never draws. Its rows
 * are panel 3's own (`MENU_GROUPS`), imported so the two cannot drift.
 */

import { renderChromeIcon } from "./appwin.js";
import { MENU_GROUPS, MENU_ICONS, renderMenuRow } from "./tour/scenes/new-agent-menu.js";

/* `WORKTREE_COLORS` (src/settings/worktree-colors.ts), in its order, on the
   landing's theme tokens. */
const COLORS = [
  { id: "green", label: "Green", value: "var(--sg-green)" },
  { id: "cyan", label: "Cyan", value: "var(--sg-cyan)" },
  { id: "purple", label: "Purple", value: "var(--sg-purple)" },
  { id: "amber", label: "Amber", value: "var(--sg-yellow)" },
  { id: "rose", label: "Rose", value: "var(--sg-red)" },
  { id: "gray", label: "Gray", value: "var(--sg-fg-dim)" },
];

/* Each loop picks the next one, so the beat never "recolours" to the colour
   the card already wears and never has to snap back to show itself again.
   Only colours no other hero checkout wears (`HERO_RAIL_COLORS` in a.js). */
const PICKS = ["purple", "green"];

/* Where the menu opens: just below and right of the press, as a context menu
   does, in app pixels (0.1cqw). */
const MENU_OFFSET = { x: 4, y: 6 };

function menuMarkup() {
  const rows = MENU_GROUPS.map((group) => group.map((row) => renderMenuRow(row, false)).join(""))
    .join('<div class="scene-menu__sep"></div>');
  const swatches = COLORS.map(
    (color) =>
      `<span class="hero-recolor__swatch" data-swatch="${color.id}" style="--swatch-color: ${color.value}"><span></span></span>`,
  ).join("");

  return `
    ${rows}
    <div class="scene-menu__sep"></div>
    <div class="scene-menu__row hero-recolor__action" data-color-action>
      <span class="scene-menu__glyph"><span class="hero-recolor__dot"></span></span>
      <span class="scene-menu__title">Worktree color</span>
      <span class="scene-menu__detail">Default</span>
    </div>
    <div class="hero-recolor__palette">
      <div class="hero-recolor__swatches">${swatches}</div>
      <span class="hero-recolor__default">Default</span>
    </div>
    <p class="scene-menu__foot">${renderChromeIcon(MENU_ICONS.info)}<span>Everything here runs in this checkout</span></p>
  `;
}

/**
 * @param {HTMLElement} win the `.a-appwin` figure
 * @returns {{ steps(): Array<{ target: () => Element | null, onPress?: () => void }>, close(): void, dispose(): void }}
 */
export function mountHeroRecolor(win) {
  const card = win.querySelector('.a-appwin__card[data-active="true"]');
  const head = card?.querySelector(".a-appwin__cardhead");

  if (!card || !head) {
    throw new Error("Hero recolour needs the active checkout card.");
  }

  const menu = document.createElement("div");
  menu.className = "scene-menu__pop hero-recolor";
  menu.setAttribute("aria-hidden", "true");
  menu.hidden = true;
  menu.innerHTML = menuMarkup();
  win.append(menu);

  let pick = 0;
  let current = null;

  function open() {
    const box = win.getBoundingClientRect();
    const rect = head.getBoundingClientRect();
    const unit = box.width / 1000;

    menu.style.left = `${rect.left - box.left + rect.width * 0.5 + MENU_OFFSET.x * unit}px`;
    menu.style.top = `${rect.top - box.top + rect.height * 0.55 + MENU_OFFSET.y * unit}px`;
    menu.style.setProperty("--worktree-color", current ?? "var(--sg-green)");
    menu.querySelector("[data-color-action] .scene-menu__detail").textContent =
      current === null ? "Default" : COLORS.find((c) => c.value === current).label;
    menu.classList.remove("is-expanded");
    menu.hidden = false;
  }

  function close() {
    menu.hidden = true;
    menu.classList.remove("is-expanded");
    menu.querySelectorAll(".is-cursor-over").forEach((node) => node.classList.remove("is-cursor-over"));
  }

  function apply(id) {
    current = COLORS.find((color) => color.id === id).value;
    card.style.setProperty("--worktree-color", current);
    close();
  }

  return {
    steps() {
      const id = PICKS[pick % PICKS.length];
      pick += 1;

      return [
        { target: () => head, onPress: open },
        {
          target: () => menu.querySelector("[data-color-action]"),
          onPress: () => menu.classList.add("is-expanded"),
        },
        { target: () => menu.querySelector(`[data-swatch="${id}"]`), onPress: () => apply(id) },
      ];
    },

    close,

    dispose() {
      menu.remove();
      card.style.removeProperty("--worktree-color");
    },
  };
}
