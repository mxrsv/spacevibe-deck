import { renderAgentStrip } from "../agent-strip.js";
import { BRAND_ICON_SRC, renderStagePane, renderStageRail, renderStageStrip } from "../appwin.js";
import { renderAppleIcon, renderWindowsIcon } from "../os-icons.js";
import { REPO_URL, WINDOWS_FALLBACK_URL } from "../download-links.js";
import { CHANGELOG_URL } from "../release-data.js";
import packageData from "../../../../package.json";
import {
  STAGE_ARIA_LABEL,
  mountStageStream,
  stagePanes,
  stageRail,
  stageStrip,
} from "../product-stage.js";
import { stageRegion } from "../tour/scenes/chrome.js";
import { RESTORE_STRIP, restoreBody } from "../tour/scenes/restore.js";
import { SURFACE_STRIP, surfacesBody } from "../tour/scenes/surfaces.js";
import { usageBody } from "../tour/scenes/usage.js";

/**
 * The hero's scene cycle (2026-08-20; the owner replaced the click tabs the
 * same day — "the workspaces run one after another"): the stage region behind
 * the one live rail advances through these four scenes on a timer, dwelling
 * `dwell` ms on each. It is the one sanctioned timer-driven transition on the
 * page, owner-asked; it shows WORK, and it stands still entirely under
 * `prefers-reduced-motion`. The three alternate scenes are the feature
 * panels' own bodies, imported rather than redrawn, so the hero and panel
 * versions of a scene cannot drift.
 *
 * Agents dwells longest: it is the flagship frame and its transcripts are
 * mid-stream. Exported for the tests, which advance fake timers by these
 * exact numbers.
 *
 * This list is ALSO the markup source: every entry with a `body` renders as a
 * `stageRegion` in declaration order, so a scene added here appears in the
 * cycle and in the DOM in one edit — `showScene` joins the two by `id`, and a
 * hand-synced pair would blank the stage for a dwell when they drift. Agents
 * has no `body` because its region is the live composition written inline.
 */
export const HERO_SCENES = [
  { id: "agents", dwell: 14000 },
  { id: "restore", dwell: 9000, body: restoreBody, strip: RESTORE_STRIP },
  { id: "surfaces", dwell: 9000, body: surfacesBody, strip: SURFACE_STRIP },
  { id: "usage", dwell: 9000, body: usageBody, strip: null },
];

const PARTNER_MARK_SRC = "/landing-prototype/assets/partner-mark.svg";
const DISCORD_URL = "https://discord.gg/Ve7xaVJ9J";

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

function renderDiscordIcon() {
  return `
    <svg class="a-discord-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M19.5 5.34A17.4 17.4 0 0 0 15.44 4l-.5 1.03a16.2 16.2 0 0 0-5.88 0L8.56 4A17.4 17.4 0 0 0 4.5 5.34C1.93 9.18 1.23 12.93 1.58 16.63a16.6 16.6 0 0 0 4.98 2.5l1.2-1.64c-.66-.25-1.3-.56-1.9-.92l.47-.36c3.67 1.7 7.65 1.7 11.28 0l.48.36c-.6.36-1.24.67-1.9.92l1.2 1.64a16.5 16.5 0 0 0 4.98-2.5c.42-4.29-.72-8-2.87-11.29ZM8.52 14.36c-1.1 0-2-1.02-2-2.28s.88-2.28 2-2.28c1.12 0 2.02 1.03 2 2.28 0 1.26-.88 2.28-2 2.28Zm6.96 0c-1.1 0-2-1.02-2-2.28s.88-2.28 2-2.28c1.12 0 2.02 1.03 2 2.28 0 1.26-.88 2.28-2 2.28Z" />
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

export function renderDirectionA(copy) {
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
            <a
              class="a-topbar__discord"
              href="${DISCORD_URL}"
              target="_blank"
              rel="noreferrer"
            >
              ${renderDiscordIcon()}
              <span data-copy="navDiscord">${copy.navDiscord}</span>
              <span aria-hidden="true">↗</span>
            </a>
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
              <!-- No status bar and no dock: the window bottom is the panes.
                   showStatusBar: false / dockOpen: false are the shipped
                   defaults, so renderStageStatus() is deliberately not called
                   here. It stays exported for the marketing video. -->
              <figure class="a-appwin" role="img" aria-label="${STAGE_ARIA_LABEL}">
                <div class="a-appwin__body" aria-hidden="true">
                  ${renderStageRail(stageRail)}
                  <!-- The stage wrapper, not the grid, is the rail's sibling
                       now: the .a-appwin__sidebar + * adjacency resolves to
                       THIS element, so it is what carries the window's one
                       structural seam and the grid must not draw a left
                       border of its own. The rail stands OUTSIDE the scene
                       regions on purpose: it is the one part of the window
                       every scene shares, and its stream hooks stay live
                       whichever region is showing. -->
                  <div class="a-appwin__stage is-revealed" data-scene="agents">
                    ${renderStageStrip(stageStrip)}
                    <div class="a-appwin__grid">
                      <div class="a-appwin__col">
                        ${renderStagePane(claudePane)}
                        ${renderStagePane(codexPane)}
                      </div>
                      ${renderStagePane(opencodePane)}
                    </div>
                  </div>
                  ${HERO_SCENES.filter((scene) => scene.body)
                    .map((scene) =>
                      stageRegion(scene.body(), scene.strip, ` data-scene="${scene.id}" hidden`),
                    )
                    .join("")}
                </div>
              </figure>
            </div>
          </div>

          <!-- Rendered inside the hero section so the landing stays one
               self-contained surface with one English copy source. -->
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

      // The chrome root is REQUIRED, not decorative. A pane's rail row and
      // its tab chip stand outside the pane grid, so with `chromeRoot` left
      // to its default the engine looks the `[data-tail]` / `[data-dot]`
      // hooks up inside the grid, finds none, tolerates the miss and runs a
      // rail that never moves — no throw, no build error, nothing on screen
      // saying so.
      const disposeStream = mountStageStream(section.querySelector(".a-appwin__grid"), {
        chromeRoot: section.querySelector(".a-appwin"),
      });

      // The scene cycle. `hidden` is the whole show/hide mechanism — a
      // region leaving display:none restarts its CSS animations, so a scene
      // replays its reveal on every visit — and `is-revealed` is the class
      // the scene animations gate on (scenes.css's one gate, shared with the
      // panels' IntersectionObserver). The stream keeps running in the hidden
      // agents region: its timers are the window's heartbeat, and pausing
      // them would hand the reader a stale transcript on the way back. Under
      // reduced motion no timer is armed at all — the hero stands on the
      // agents frame.
      const regions = [...section.querySelectorAll(".a-appwin__stage[data-scene]")];
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let sceneIndex = 0;
      let sceneTimer = null;
      let cycling = false;

      function showScene(index) {
        const scene = HERO_SCENES[index].id;

        for (const region of regions) {
          const shown = region.dataset.scene === scene;
          region.hidden = !shown;
          region.classList.toggle("is-revealed", shown);
        }
      }

      function armSceneTimer() {
        cycling = true;
        sceneTimer = setTimeout(() => {
          sceneIndex = (sceneIndex + 1) % HERO_SCENES.length;
          showScene(sceneIndex);
          armSceneTimer();
        }, HERO_SCENES[sceneIndex].dwell);
      }

      // The cycle pauses while the hero is off screen: swapping regions and
      // replaying their reveals under the fold is pure waste, indefinitely.
      // Armed OPTIMISTICALLY — the observer only ever pauses and resumes —
      // so an environment without IntersectionObserver (jsdom) simply cycles
      // ungated rather than not at all.
      let sceneObserver = null;

      if (!reduceMotion.matches) {
        armSceneTimer();

        if (typeof IntersectionObserver !== "undefined") {
          sceneObserver = new IntersectionObserver((entries) => {
            const visible = entries.some((entry) => entry.isIntersecting);

            if (!visible && cycling) {
              cycling = false;
              clearTimeout(sceneTimer);
            } else if (visible && !cycling) {
              armSceneTimer();
            }
          });
          sceneObserver.observe(section.querySelector(".a-desk"));
        }
      }

      return () => {
        sceneObserver?.disconnect();
        clearTimeout(sceneTimer);
        disposeStream();

        if (document.documentElement.dataset.directionTreatment === "a") {
          delete document.documentElement.dataset.directionTreatment;
        }
      };
    },
  };
}
