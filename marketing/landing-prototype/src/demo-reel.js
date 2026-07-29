/**
 * Demo band — the marketing film, playing in the page.
 *
 * The film used to live behind a click, in a 62rem modal. It is the one place
 * the product moves for real, so it now sits between the hero and the tour at
 * full frame width, plays itself when it scrolls into view, and carries its
 * own beat markers so a viewer can jump straight to the moment they care
 * about.
 *
 * Sources are the hand-published render cut in `marketing/` (see
 * marketing/video/README.md); they are referenced by absolute URL because the
 * build mirrors them to the site root rather than passing them through Rollup.
 */

import { BRAND } from "../../stage/brand.js";

/** Anchor every "watch the demo" control points at. */
export const REEL_ID = "see-it-run";

/** Length of the published cut, in seconds (hero preset range in presets.js). */
const REEL_DURATION = 16.2;

/**
 * Beat markers, from the film's own beat sheet (marketing/video/src/script.js).
 * `key` resolves against the locale copy so the labels translate with the page.
 */
const CHAPTERS = Object.freeze([
  { t: 0, key: "demoCh1" },
  { t: 3.2, key: "demoCh2" },
  { t: 11, key: "demoCh3" },
  { t: 13.1, key: "demoCh4" },
]);

/** Play once this much of the frame is on screen; pause when it drops below. */
const VISIBILITY_RATIO = 0.4;

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));

  return `0:${String(whole).padStart(2, "0")}`;
}

function renderPlayGlyph() {
  return `
    <svg class="reel__glyph reel__glyph--play" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
    <svg class="reel__glyph reel__glyph--pause" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
    </svg>
  `;
}

function renderFullscreenGlyph() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
      <path
        d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="square"
      />
    </svg>
  `;
}

function renderChapters(copy) {
  return CHAPTERS.map(
    (chapter, index) => `
      <button
        class="reel__chapter"
        type="button"
        data-reel-seek="${chapter.t}"
        aria-pressed="${index === 0}"
      >
        <span class="reel__chaptime">${formatTime(chapter.t)}</span>
        <span data-copy="${chapter.key}">${copy[chapter.key]}</span>
      </button>
    `,
  ).join("");
}

function renderMarkup(copy) {
  const label = `${BRAND.name} — ${copy.demoAria}`;

  return `
    <section class="reel" id="${REEL_ID}">
      <div class="reel__inner">
        <div class="reel__band">
          <div class="reel__heading">
            <p class="reel__label" data-copy="demoLabel">${copy.demoLabel}</p>
            <h2 data-copy="demoTitle">${copy.demoTitle}</h2>
          </div>
          <p class="reel__lede" data-copy="demoBody">${copy.demoBody}</p>
        </div>
        <figure class="reel__frame" data-reel-frame data-state="paused">
          <div class="reel__screen">
            <video
              class="reel__video"
              data-reel-video
              muted
              loop
              playsinline
              preload="metadata"
              poster="/deck-tour-poster.png"
              data-copy-aria="demoAria"
              aria-label="${label}"
            >
              <source src="/deck-tour.webm" type="video/webm" />
              <source src="/deck-tour.mp4" type="video/mp4" />
            </video>
            <button
              class="reel__tap"
              type="button"
              data-reel-toggle
              data-copy-aria="demoPlay"
              aria-label="${copy.demoPlay}"
            >
              <span class="reel__tapdot">${renderPlayGlyph()}</span>
            </button>
            <p class="reel__failed" data-reel-error>
              <span data-copy="demoFailed">${copy.demoFailed}</span>
            </p>
          </div>
          <div class="reel__hud">
            <span class="reel__time" data-reel-time>0:00 / ${formatTime(REEL_DURATION)}</span>
            <div class="reel__track" aria-hidden="true">
              <i data-reel-progress></i>
            </div>
            <button
              class="reel__iconbtn"
              type="button"
              data-reel-fullscreen
              data-copy-aria="demoFullscreen"
              aria-label="${copy.demoFullscreen}"
            >
              ${renderFullscreenGlyph()}
            </button>
          </div>
          <div
            class="reel__chapters"
            role="group"
            data-copy-aria="demoChaptersLabel"
            aria-label="${copy.demoChaptersLabel}"
          >
            ${renderChapters(copy)}
          </div>
        </figure>
      </div>
    </section>
  `;
}

/**
 * @param {HTMLElement} section
 * @returns {() => void} dispose
 */
function mountReel(section) {
  const video = section.querySelector("[data-reel-video]");
  const frame = section.querySelector("[data-reel-frame]");
  const toggle = section.querySelector("[data-reel-toggle]");
  const progress = section.querySelector("[data-reel-progress]");
  const timeEl = section.querySelector("[data-reel-time]");
  const fullscreenButton = section.querySelector("[data-reel-fullscreen]");
  const chapters = [...section.querySelectorAll("[data-reel-seek]")];

  if (!video || !frame || !toggle || !progress || !timeEl) {
    throw new Error("Demo reel markup is missing.");
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let rafId = null;

  function paint() {
    rafId = null;

    const duration = Number.isFinite(video.duration)
      ? video.duration
      : REEL_DURATION;
    const ratio = duration > 0 ? video.currentTime / duration : 0;

    progress.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
    timeEl.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;

    let active = 0;

    for (let i = 0; i < CHAPTERS.length; i += 1) {
      if (video.currentTime + 0.05 >= CHAPTERS[i].t) {
        active = i;
      }
    }

    chapters.forEach((button, index) => {
      button.setAttribute("aria-pressed", String(index === active));
    });

    if (!video.paused) {
      rafId = requestAnimationFrame(paint);
    }
  }

  function schedulePaint() {
    if (rafId === null) {
      rafId = requestAnimationFrame(paint);
    }
  }

  function play() {
    // Autoplay can be refused (a low-power device, a user setting). Falling
    // back to the paused state keeps the play affordance on screen instead of
    // leaving a still frame that looks broken.
    video.play().catch(() => {
      frame.dataset.state = "paused";
    });
  }

  function handleToggle() {
    if (video.paused) {
      play();
      return;
    }

    video.pause();
  }

  function handleSeek(event) {
    const time = Number.parseFloat(event.currentTarget.dataset.reelSeek);

    if (!Number.isFinite(time)) {
      return;
    }

    video.currentTime = time;
    schedulePaint();

    if (video.paused) {
      play();
    }
  }

  function handleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }

    // Safari on iPhone never leaves the native player, so fall back to it.
    const request =
      frame.requestFullscreen?.bind(frame) ??
      video.webkitEnterFullscreen?.bind(video);

    request?.();
  }

  function handlePlay() {
    frame.dataset.state = "playing";
    schedulePaint();
  }

  function handlePause() {
    frame.dataset.state = "paused";
    schedulePaint();
  }

  function handleError() {
    frame.dataset.state = "error";
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (frame.dataset.state === "error") {
          return;
        }

        if (entry.isIntersecting && !reduceMotion.matches) {
          play();
        } else if (!entry.isIntersecting && !video.paused) {
          video.pause();
        }
      }
    },
    { threshold: VISIBILITY_RATIO },
  );

  observer.observe(frame);
  toggle.addEventListener("click", handleToggle);
  fullscreenButton?.addEventListener("click", handleFullscreen);
  chapters.forEach((button) => button.addEventListener("click", handleSeek));
  video.addEventListener("play", handlePlay);
  video.addEventListener("pause", handlePause);
  video.addEventListener("error", handleError);
  video.addEventListener("loadedmetadata", schedulePaint);
  // While playing, rAF drives the HUD. These cover the paused paths — a seek
  // that lands while stopped, and browsers that throttle rAF off-screen.
  video.addEventListener("seeked", schedulePaint);
  video.addEventListener("timeupdate", schedulePaint);

  return () => {
    observer.disconnect();
    toggle.removeEventListener("click", handleToggle);
    fullscreenButton?.removeEventListener("click", handleFullscreen);
    chapters.forEach((button) =>
      button.removeEventListener("click", handleSeek),
    );
    video.removeEventListener("play", handlePlay);
    video.removeEventListener("pause", handlePause);
    video.removeEventListener("error", handleError);
    video.removeEventListener("loadedmetadata", schedulePaint);
    video.removeEventListener("seeked", schedulePaint);
    video.removeEventListener("timeupdate", schedulePaint);

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }

    video.pause();
  };
}

/**
 * Swap the band's text in place — the page changes locale without a re-render
 * so the film keeps playing across the switch.
 *
 * @param {HTMLElement} root
 * @param {Record<string, string>} copy
 */
export function updateDemoReelLocale(root, copy) {
  const section = root.querySelector(`#${REEL_ID}`);

  if (!section) {
    throw new Error("Demo reel root is missing.");
  }

  for (const node of section.querySelectorAll("[data-copy]")) {
    const text = copy[node.dataset.copy];

    if (typeof text === "string") {
      node.textContent = text;
    }
  }

  for (const node of section.querySelectorAll("[data-copy-aria]")) {
    const key = node.dataset.copyAria;
    const text = copy[key];

    if (typeof text !== "string") {
      continue;
    }

    node.setAttribute(
      "aria-label",
      key === "demoAria" ? `${BRAND.name} — ${text}` : text,
    );
  }
}

/**
 * @param {Record<string, string>} copy
 * @returns {{ markup: string, mount: (root: HTMLElement) => () => void }}
 */
export function renderDemoReel(copy) {
  return {
    markup: renderMarkup(copy),
    mount(root) {
      const section = root.querySelector(`#${REEL_ID}`);

      if (!section) {
        throw new Error("Demo reel root is missing.");
      }

      return mountReel(section);
    },
  };
}
