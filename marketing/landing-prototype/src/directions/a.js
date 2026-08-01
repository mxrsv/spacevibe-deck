import {
  BRAND_ICON_SRC,
  renderStagePane,
  renderStageSidebar,
  renderStageStatus,
  renderStageTitlebar,
} from "../appwin.js";
import { REEL_ID } from "../demo-reel.js";
import { renderAppleIcon, renderWindowsIcon } from "../os-icons.js";
import {
  REPO_URL,
  RELEASES_URL,
  WINDOWS_FALLBACK_URL,
} from "../download-links.js";
import {
  STAGE_ARIA_LABEL,
  mountStageStream,
  stagePanes,
} from "../product-stage.js";

const PARTNER_MARK_SRC = "/landing-prototype/assets/partner-mark.svg";

// Hero beams field. White key light on purpose: the hero runs a neutral
// grey-white light language, and the one white face in the column is the
// macOS download. See beams.js for what each knob does.
//
// rotation 14 is not arbitrary — it is the same 14° off-vertical the hub
// landing tilts its light sweep to. Straight columns read as blinds behind
// left-aligned type; tilted, they read as shafts.
//
// beamHeight/beamNumber are sized so the slab still covers the frustum AFTER
// that tilt: a 14° rotation costs roughly `viewportHeight * sin(14°)` of extra
// width and the same again in height, and running short leaves bare corners.
const HERO_BEAMS = {
  beamWidth: 2,
  beamHeight: 20,
  beamNumber: 14,
  lightColor: "#ffffff",
  lightIntensity: 2.6,
  speed: 2,
  noiseIntensity: 1.4,
  scale: 0.2,
  rotation: 14,
};

function renderGithubIcon() {
  return `
    <svg class="a-github-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.1-.55-.17-.55-.38
        0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95
        0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27
        -.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12
        -.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07
        -.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13
        .16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
    </svg>
  `;
}

function renderBrandMark(copy) {
  return `
    <span class="a-brand-mark" aria-hidden="true">
      <img class="a-partner-mark" src="${PARTNER_MARK_SRC}" alt="" width="22" height="22" />
      <span class="a-brand-divider"></span>
      <img class="a-brand-icon" src="${BRAND_ICON_SRC}" alt="" width="28" height="28" />
    </span>
    <strong data-copy="navProduct">${copy.navProduct}</strong>
  `;
}

export function renderDirectionA(copy, locale) {
  const [claudePane, codexPane, opencodePane] = stagePanes;

  return {
    markup: `
      <section class="direction-a" data-hero-motion="beams">
        <div class="a-motion" data-motion="beams" aria-hidden="true"></div>

        <div class="a-main">
          <header class="a-topbar">
            <a class="a-topbar__brand" href="/landing-prototype/?direction=A" aria-label="${copy.navProduct}">
              ${renderBrandMark(copy)}
            </a>
            <span class="a-topbar__descriptor">Native macOS / PTY field</span>
            <div class="a-topbar__lang" role="group" aria-label="${copy.localeLabel}" data-active="${locale}">
              <span class="a-topbar__lang-thumb" aria-hidden="true"></span>
              <button type="button" class="a-topbar__lang-btn" data-locale="en" aria-pressed="${locale === "en"}">EN</button>
              <button type="button" class="a-topbar__lang-btn" data-locale="vi" aria-pressed="${locale === "vi"}">VI</button>
            </div>
            <a
              class="a-topbar__github"
              href="${REPO_URL}"
              target="_blank"
              rel="noreferrer"
            >
              ${renderGithubIcon()}
              <span data-copy="navGithub">${copy.navGithub}</span>
              <span aria-hidden="true">↗</span>
            </a>
          </header>

          <div class="a-band">
            <p class="band-label" data-copy="heroLabel">${copy.heroLabel}</p>
            <h1>
              <span data-copy="headlineLead">${copy.headlineLead}</span>
              <span data-copy="headlineTail">${copy.headlineTail}</span>
            </h1>
          </div>

          <div class="a-deck">
            <div class="a-deck__intro">
              <p class="a-subhead" data-copy="subhead">${copy.subhead}</p>

              <div class="a-actions">
                <a
                  class="a-primary-cta"
                  href="${RELEASES_URL}"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span class="a-cta-lead">
                    ${renderAppleIcon()}
                    <span data-copy="downloadMac">${copy.downloadMac}</span>
                  </span>
                  <i aria-hidden="true">↓</i>
                </a>

                <a
                  class="a-quiet-cta"
                  href="${WINDOWS_FALLBACK_URL}"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span class="a-cta-lead">
                    ${renderWindowsIcon()}
                    <span data-copy="downloadWin">${copy.downloadWin}</span>
                  </span>
                  <span class="a-cta-tag" data-copy="winPreviewTag"
                    >${copy.winPreviewTag}</span
                  >
                </a>

                <p class="a-cta-note" data-copy="winUnsignedNote">
                  ${copy.winUnsignedNote}
                </p>

                <a class="a-quiet-cta" href="#${REEL_ID}">
                  <span class="a-cta-lead">
                    <span data-copy="primaryCta">${copy.primaryCta}</span>
                  </span>
                  <i aria-hidden="true">↓</i>
                </a>

                <a
                  class="a-secondary-cta"
                  href="${REPO_URL}"
                  target="_blank"
                  rel="noreferrer"
                >
                  ${renderGithubIcon()}
                  <span data-copy="secondaryCta">${copy.secondaryCta}</span>
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>

            <div class="a-deck__stage">
              <figure class="a-appwin" role="img" aria-label="${STAGE_ARIA_LABEL}">
                ${renderStageTitlebar()}
                <div class="a-appwin__body" aria-hidden="true">
                  ${renderStageSidebar()}
                  <div class="a-appwin__grid">
                    <div class="a-appwin__col">
                      ${renderStagePane(claudePane)}
                      ${renderStagePane(codexPane)}
                    </div>
                    ${renderStagePane(opencodePane)}
                  </div>
                </div>
                ${renderStageStatus()}
              </figure>
            </div>
          </div>
        </div>
      </section>
    `,
    mount(root) {
      const section = root.querySelector(".direction-a");

      if (!section) {
        throw new Error("Direction A root is missing.");
      }

      document.documentElement.dataset.directionTreatment = "a";

      // three costs ~130 kB gzipped — six times the rest of this page put
      // together — so it is fetched as its own chunk AFTER first paint. Nothing
      // above the fold waits on it: the band, the copy, the actions and the
      // window mock are all plain DOM. Only the light field itself arrives
      // late, and it fades in when it does (see beams.css).
      let beams = null;
      let beamsAbandoned = false;

      import("../beams.js")
        .then(({ mountBeams }) => {
          if (beamsAbandoned) {
            return;
          }

          beams = mountBeams(section.querySelector(".a-motion"), HERO_BEAMS);
        })
        .catch((error) => {
          // Nothing to retry — the field is decoration and the hero is fully
          // readable without it. Fall back to the static plus-grid this
          // treatment normally suppresses, then let the failure surface.
          section.dataset.heroMotion = "none";
          throw error;
        });

      const disposeStream = mountStageStream(
        section.querySelector(".a-appwin__grid"),
      );

      return () => {
        disposeStream();
        beamsAbandoned = true;
        beams?.dispose();

        if (document.documentElement.dataset.directionTreatment === "a") {
          delete document.documentElement.dataset.directionTreatment;
        }
      };
    },
  };
}

/**
 * Swap the localized copy on an already-mounted page without rebuilding the
 * DOM, so the beams canvas and stage stream keep running across a locale
 * toggle.
 *
 * @param {Element} root
 * @param {Record<string, string>} copy
 * @param {string} locale
 */
export function updateDirectionALocale(root, copy, locale) {
  const section = root.querySelector(".direction-a");

  if (!section) {
    throw new Error("Direction A root is missing.");
  }

  for (const node of section.querySelectorAll("[data-copy]")) {
    const text = copy[node.dataset.copy];

    if (typeof text !== "string") {
      continue;
    }

    node.textContent = text;

    if (node.hasAttribute("data-text")) {
      node.setAttribute("data-text", text);
    }
  }

  section
    .querySelector(".a-topbar__brand")
    ?.setAttribute("aria-label", copy.navProduct);

  const langGroup = section.querySelector(".a-topbar__lang");

  if (langGroup) {
    langGroup.setAttribute("aria-label", copy.localeLabel);
    langGroup.dataset.active = locale;

    for (const button of langGroup.querySelectorAll("button[data-locale]")) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.locale === locale),
      );
    }
  }
}
