import { renderAgentStrip } from "../agent-strip.js";
import {
  BRAND_ICON_SRC,
  renderStagePane,
  renderStageSidebar,
  renderStageStatus,
} from "../appwin.js";
import { renderAppleIcon, renderWindowsIcon } from "../os-icons.js";
import { REPO_URL, WINDOWS_FALLBACK_URL } from "../download-links.js";
import { CHANGELOG_URL } from "../release-data.js";
import packageData from "../../../../package.json";
import {
  STAGE_ARIA_LABEL,
  mountStageStream,
  stagePanes,
} from "../product-stage.js";

const PARTNER_MARK_SRC = "/landing-prototype/assets/partner-mark.svg";

/** Anchor on the feature panel stack (tour/index.js renders the target). */
export const FEATURES_ID = "features";

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
      <section class="direction-a">
        <div class="a-main">
          <header class="a-topbar">
            <a class="a-topbar__brand" href="/landing-prototype/?direction=A" aria-label="${copy.navProduct}">
              ${renderBrandMark(copy)}
            </a>
            <span class="a-topbar__descriptor">Windows + macOS / PTY field</span>
            <a class="a-topbar__changelog" href="${CHANGELOG_URL}">
              <span data-copy="navChangelog">${copy.navChangelog}</span>
            </a>
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

          <div class="a-hero">
            <!-- The release badge leads the centred stack instead of sitting
                 above the download button: in a centred hero the pill is the
                 first object the eye lands on, so it carries the version and
                 links to the ledger rather than announcing nothing. -->
            <a class="a-hero__pill" href="${CHANGELOG_URL}">
              <span class="a-cta-tag a-cta-new__tag" data-copy="newBadge">${copy.newBadge}</span>
              <span class="a-hero__pill-text" data-release-version>v${packageData.version}</span>
              <span aria-hidden="true">→</span>
            </a>

            <p class="band-label" data-copy="heroLabel">${copy.heroLabel}</p>

            <h1>
              <span data-copy="headlineLead">${copy.headlineLead}</span>
              <span data-copy="headlineTail">${copy.headlineTail}</span>
            </h1>

            <p class="a-subhead" data-copy="subhead">${copy.subhead}</p>

            <div class="a-actions">
              <a
                class="a-primary-cta"
                href="${WINDOWS_FALLBACK_URL}"
                target="_blank"
                rel="noreferrer"
              >
                <span class="a-cta-lead">
                  ${renderWindowsIcon()}
                  <span data-copy="downloadWin">${copy.downloadWin}</span>
                </span>
                <span class="a-cta-trail">
                  <span class="a-cta-tag" data-copy="winPreviewTag"
                    >${copy.winPreviewTag}</span
                  >
                  <i aria-hidden="true">↓</i>
                </span>
              </a>

              <!-- A button, not an anchor: the macOS build is announced, not
                   offered, until the Electron macOS release lands. Being a
                   non-anchor is also what keeps upgradeReleaseLinks from
                   retargeting it at the old .dmg — see download-links.js. -->
              <button class="a-quiet-cta" type="button" disabled>
                <span class="a-cta-lead">
                  ${renderAppleIcon()}
                  <span data-copy="downloadMac">${copy.downloadMac}</span>
                </span>
                <span class="a-cta-tag" data-copy="comingSoon"
                  >${copy.comingSoon}</span
                >
              </button>

              <!-- Pointed at the feature panels since 2026-08-19. It used to
                   open the 16-second demo reel, which was cut that day for
                   showing a build the app has moved past. -->
              <a class="a-ghost-cta" href="#${FEATURES_ID}">
                <span data-copy="seeFeatures">${copy.seeFeatures}</span>
                <i aria-hidden="true">↓</i>
              </a>
            </div>

            <!-- The SmartScreen warning used to sit here, between the buttons
                 and the footnote row. Cut from the hero on 2026-08-19: it is a
                 caveat about what happens AFTER the click, and three lines of
                 it under a centred CTA read as the loudest thing in the block.
                 The closing band still carries it (see tour/index.js), which is
                 where a visitor is when they are deciding, not landing. -->

            <!-- One quiet evidence row under the actions: repo, then the live
                 release count. Both were their own blocks in the left-rail
                 hero; centred, they read as one line of footnotes. -->
            <div class="a-hero__meta">
              <a
                class="a-secondary-cta"
                href="${REPO_URL}"
                target="_blank"
                rel="noreferrer"
              >
                ${renderGithubIcon()}
                <span data-copy="secondaryCta">${copy.secondaryCta}</span>
              </a>
              <span class="a-hero__meta-sep" aria-hidden="true"></span>
              <aside
                class="a-download-proof"
                data-download-proof
                data-download-state="loading"
                aria-live="polite"
                aria-atomic="true"
              >
                <strong data-download-count>—</strong>
                <span class="a-download-proof__unit" data-copy="downloadCountUnit">${copy.downloadCountUnit}</span>
                <span class="a-download-proof__separator" aria-hidden="true">·</span>
                <span class="a-download-proof__status">
                  <span data-download-loading data-copy="downloadCountLoading">${copy.downloadCountLoading}</span>
                  <span data-download-ready data-copy="downloadCountReady" hidden>${copy.downloadCountReady}</span>
                  <span data-download-unavailable data-copy="downloadCountUnavailable" hidden>${copy.downloadCountUnavailable}</span>
                </span>
              </aside>
            </div>
          </div>

          <!-- The desk: the painting is the plane the window sits ON, not a
               field behind the type. Its lit centre is what separates a dark
               window from a dark page — warmth, not luminance. -->
          <div class="a-stage">
            <div class="a-desk">
              <div class="a-desk__art" aria-hidden="true"></div>
              <figure class="a-appwin" role="img" aria-label="${STAGE_ARIA_LABEL}">
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

          <!-- Rendered inside the hero section on purpose: every [data-copy]
               node in here is then swapped by updateDirectionALocale, so the
               strip needs no mount and no locale path of its own. -->
          ${renderAgentStrip(copy)}
        </div>
      </section>
    `,
    mount(root) {
      const section = root.querySelector(".direction-a");

      if (!section) {
        throw new Error("Direction A root is missing.");
      }

      document.documentElement.dataset.directionTreatment = "a";

      const disposeStream = mountStageStream(
        section.querySelector(".a-appwin__grid"),
      );

      return () => {
        disposeStream();

        if (document.documentElement.dataset.directionTreatment === "a") {
          delete document.documentElement.dataset.directionTreatment;
        }
      };
    },
  };
}

/**
 * Swap the localized copy on an already-mounted page without rebuilding the
 * DOM, so the stage stream keeps running across a locale toggle.
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
