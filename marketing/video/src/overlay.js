/**
 * Everything painted on top of the window: the keyboard callouts and the
 * closing card.
 *
 * These are the only elements in the film that are not app chrome, so they
 * stay visually separate — outside the window, in the display face, never
 * imitating a control the app doesn't have.
 */

import { BRAND } from "../../stage/brand.js";
import { END_CARD, HUD } from "./copy.js";

/**
 * Vertical-only furniture: a brand strip above the window and a large caption
 * below it. Both are hidden by CSS in landscape — a phone viewer can't read
 * pane transcripts, so the 9:16 cut carries the story in type instead.
 */
function renderVerticalChrome() {
  return `
    <div class="vid-vbrand" aria-hidden="true">
      <img src="${BRAND.iconSrc}" alt="" />
      <span>${BRAND.name}</span>
    </div>
    <div class="vid-vcaption" data-caption aria-hidden="true">
      <kbd data-caption-keys></kbd>
      <p data-caption-text></p>
    </div>
  `;
}

function renderHud(id, entry) {
  return `
    <div class="vid-hud" data-hud="${id}">
      <kbd>${entry.keys}</kbd>
      <span>${entry.text}</span>
    </div>
  `;
}

function renderEndCard() {
  const shortcuts = END_CARD.shortcuts
    .map(
      (item) =>
        `<span class="vid-sc"><kbd>${item.keys}</kbd>${item.label}</span>`,
    )
    .join("");

  return `
    <div class="vid-endcard" data-endcard>
      <img class="vid-endlogo" src="${BRAND.iconSrc}" alt="" />
      <h1 class="vid-endname">${END_CARD.name}</h1>
      <p class="vid-endtag">${END_CARD.tagline}</p>
      <p class="vid-endsub">${END_CARD.sub}</p>
      <div class="vid-endsc">${shortcuts}</div>
    </div>
  `;
}

/**
 * @param {HTMLElement} host
 */
export function createOverlay(host) {
  if (!host) {
    throw new Error("Overlay host is missing.");
  }

  host.innerHTML = `
    <div class="vid-scrim" data-scrim></div>
    ${renderVerticalChrome()}
    <div class="vid-huds">
      ${renderHud("jump", HUD.jump)}
      ${renderHud("expand", HUD.expand)}
    </div>
    ${renderEndCard()}
  `;

  const scrim = host.querySelector("[data-scrim]");
  const endCard = host.querySelector("[data-endcard]");
  const caption = host.querySelector("[data-caption]");
  const captionKeys = host.querySelector("[data-caption-keys]");
  const captionText = host.querySelector("[data-caption-text]");
  const huds = {
    jump: host.querySelector('[data-hud="jump"]'),
    expand: host.querySelector('[data-hud="expand"]'),
  };

  if (!scrim || !endCard || !huds.jump || !huds.expand) {
    throw new Error("Overlay markup is incomplete.");
  }

  if (!caption || !captionKeys || !captionText) {
    throw new Error("Vertical caption markup is incomplete.");
  }

  let captionIndex = -2;

  return {
    /** @param {ReturnType<import("./script.js").sceneStateAt>} state */
    apply(state) {
      scrim.style.opacity = String(state.scrim);

      for (const [id, el] of Object.entries(huds)) {
        const value = state.hud[id];

        el.style.opacity = String(value);
        el.style.transform = `translateY(${(1 - value) * 0.9}rem)`;
        el.style.visibility = value <= 0.001 ? "hidden" : "";
      }

      endCard.style.opacity = String(state.endCard);
      endCard.style.transform = `translateY(${(1 - state.endCard) * 1.4}rem)`;
      endCard.style.visibility = state.endCard <= 0.001 ? "hidden" : "";

      if (state.caption.index !== captionIndex) {
        captionIndex = state.caption.index;
        captionText.textContent = state.caption.text;
        captionKeys.textContent = state.caption.keys ?? "";
        captionKeys.hidden = state.caption.keys === null;
      }

      const captionOpacity = state.caption.opacity * (1 - state.endCard);

      caption.style.opacity = String(captionOpacity);
      caption.style.transform = `translateY(${(1 - captionOpacity) * 0.8}rem)`;
      caption.style.visibility = captionOpacity <= 0.001 ? "hidden" : "";
    },
  };
}
