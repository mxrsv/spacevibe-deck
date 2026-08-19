/**
 * The six feature panels, the closing band and the footer.
 *
 * Until 2026-08-19 this was a scroll tour: one ".a-appwin" pinned at viewport
 * centre, morphing through three chapters driven by scroll progress over a
 * 340svh track. It is a stack of panels now — a sentence one side, its own
 * window mock the other — which is the shape cursor.com uses and which needs
 * no pin, no progress maths and no chapter state. The section class stays
 * `.tour` because the closing band and footer below it are `.tour__*` and did
 * not change.
 */

import { BRAND } from "../../../stage/brand.js";
import { BRAND_ICON_SRC } from "../appwin.js";
import { FEATURES_ID } from "../directions/a.js";
import { PROOF_TERM_STEPS } from "./stage-states.js";
import { REPO_URL, WINDOWS_FALLBACK_URL } from "../download-links.js";
import { SCENES } from "./panel-scenes.js";
import { renderAppleIcon, renderWindowsIcon } from "../os-icons.js";

const PROMPT = "❯ ";

/** Staggered reveal for the closing band's blocks. */
function mountFinaleReveal(section) {
  const targets = [...section.querySelectorAll("[data-reveal]")];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.25 },
  );

  targets.forEach((target) => observer.observe(target));

  return () => observer.disconnect();
}

/**
 * Proof terminal: once scrolled into view, type each command, print its
 * output, and light the matching proof chip. Runs once, then rests on a
 * blinking prompt. Reduced motion renders the finished session instantly.
 */
function mountProofTerm(section, reduceMotion) {
  const body = section.querySelector("[data-proof-term]");
  const chips = new Map(
    [...section.querySelectorAll("[data-proof]")].map((el) => [
      el.dataset.proof,
      el,
    ]),
  );

  if (!body) {
    throw new Error("Proof terminal markup is missing.");
  }

  let timerId = null;
  let started = false;
  let disposed = false;

  function addLine(cls) {
    const line = document.createElement("div");
    line.className = cls;
    body.append(line);
    return line;
  }

  function addIdlePrompt() {
    addLine("tour__tl tour__tl--cmd tour__tl--idle").textContent = PROMPT;
  }

  function renderFinished() {
    for (const step of PROOF_TERM_STEPS) {
      addLine("tour__tl tour__tl--cmd").textContent = PROMPT + step.cmd;
      for (const out of step.out) {
        addLine("tour__tl tour__tl--out").textContent = out;
      }
      chips.get(step.chip)?.classList.add("is-lit");
    }
    addIdlePrompt();
  }

  function run(stepIndex) {
    if (disposed) {
      return;
    }

    if (stepIndex >= PROOF_TERM_STEPS.length) {
      addIdlePrompt();
      return;
    }

    const step = PROOF_TERM_STEPS[stepIndex];
    const lineEl = addLine("tour__tl tour__tl--cmd tour__tl--typing");
    lineEl.textContent = PROMPT;
    let charIndex = 0;

    function typeChar() {
      if (disposed) {
        return;
      }

      if (charIndex < step.cmd.length) {
        charIndex += 1;
        lineEl.textContent = PROMPT + step.cmd.slice(0, charIndex);
        timerId = setTimeout(typeChar, 26 + Math.random() * 38);
        return;
      }

      lineEl.classList.remove("tour__tl--typing");
      printOut(0);
    }

    function printOut(outIndex) {
      if (disposed) {
        return;
      }

      if (outIndex < step.out.length) {
        addLine("tour__tl tour__tl--out").textContent = step.out[outIndex];
        timerId = setTimeout(() => printOut(outIndex + 1), 150);
        return;
      }

      chips.get(step.chip)?.classList.add("is-lit");
      timerId = setTimeout(() => run(stepIndex + 1), 680);
    }

    timerId = setTimeout(typeChar, 220);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (started || !entries.some((entry) => entry.isIntersecting)) {
        return;
      }

      started = true;
      observer.disconnect();

      if (reduceMotion.matches) {
        renderFinished();
      } else {
        run(0);
      }
    },
    { threshold: 0.35 },
  );
  observer.observe(body);

  return () => {
    disposed = true;
    clearTimeout(timerId);
    observer.disconnect();
  };
}

/**
 * The panel stack, in scroll order. Each entry is one feature: the copy keys
 * it prints and the scene it draws.
 *
 * Nothing the 16-second reel already tells survives here. Its beats are
 * `Open board → three agents → ⌘⇧A → ⌘E`, and the last panel that still redrew
 * the pane grid was handing the reader a still of what they had just watched
 * move. What replaced it is six things the page never said at all: what the
 * rail reads off a running agent, opening one straight into a worktree, what
 * survives a quit, the surfaces that are not terminals, what the agents cost,
 * and the catalog of commands Deck will type.
 *
 * `shape` picks the panel's layout — `side` stands the mock beside the copy,
 * `wide` puts it under a full-width sentence — and `flip` moves the art to the
 * reader's left. Both are emitted as data attributes for tour.css to read;
 * nothing here styles anything, and no panel imports a scene module directly.
 */
const PANELS = [
  { key: "panelRail", scene: "rail", shape: "side", flip: true },
  { key: "panelWorktree", scene: "picker", shape: "side" },
  { key: "panelRestore", scene: "restore", shape: "wide" },
  { key: "panelSurfaces", scene: "surfaces", shape: "wide" },
  { key: "panelUsage", scene: "usage", shape: "side" },
  { key: "panelCatalog", scene: "catalog", shape: "side", flip: true },
];

/**
 * One feature panel: a sentence on one side, a window mock bleeding off the
 * other. Replaces the sticky scroll tour, which told its beats by morphing ONE
 * pinned window through them — panels say it in the page's own scroll, with no
 * pin, no progress maths and no chapter state.
 *
 * @param {{key: string, scene: string, shape: string, flip?: boolean}} panel
 * @param {number} index zero-based position in the stack
 * @param {Record<string, string>} copy
 */
function renderPanel(panel, index, copy) {
  const number = String(index + 1).padStart(2, "0");
  const scene = SCENES[panel.scene]();

  return `
    <article
      class="panel"
      data-scene="${panel.scene}"
      data-shape="${panel.shape}"
      ${panel.flip ? "data-flip" : ""}
      data-reveal
      style="--reveal-delay: ${index * 50}ms"
    >
      <div class="panel__copy">
        <span class="panel__num">${number}</span>
        <h2 data-copy="${panel.key}Title">${copy[`${panel.key}Title`]}</h2>
        <p data-copy="${panel.key}Body">${copy[`${panel.key}Body`]}</p>
      </div>
      <div class="panel__art">
        <!-- Same idea as the hero desk: the mock stands ON something. Held
             further back here — one picture at full strength per page — and
             cropped to a different part of the canvas per panel so the planes
             on one page are not copies of one frame. -->
        <div class="panel__stage">
          <div class="panel__stage-art" aria-hidden="true"></div>
          ${scene}
        </div>
      </div>
    </article>
  `;
}

function renderFinale(copy) {
  const proofs = ["Pty", "Open", "Local"]
    .map(
      (key, index) => `
        <article class="tour__proof" data-proof="${key}" data-reveal style="--reveal-delay: ${80 + index * 80}ms">
          <strong data-copy="proof${key}Title">${copy[`proof${key}Title`]}</strong>
          <p data-copy="proof${key}Body">${copy[`proof${key}Body`]}</p>
        </article>
      `,
    )
    .join("");

  const shortcuts = [
    ["⌘D", "scSplit"],
    ["⌘⇧D", "scSplitH"],
    ["⌘T", "scTab"],
    ["⌘E", "scExpand"],
    ["⌘F", "scFind"],
    ["⌘K", "scClear"],
    ["⌘⇧B", "scExplorer"],
    ["⌘⇧Y", "scSessions"],
  ]
    .map(
      ([keys, copyKey]) => `
        <span class="tour__sc">
          <kbd>${keys}</kbd>
          <span data-copy="${copyKey}">${copy[copyKey]}</span>
        </span>
      `,
    )
    .join("");

  return `
    <footer class="tour__finale">
      <div class="tour__band" data-reveal>
        <p class="band-label" data-copy="finaleLabel">${copy.finaleLabel}</p>
        <h2 data-copy="finaleTitle">${copy.finaleTitle}</h2>
      </div>
      <div class="tour__finale-grid">
        <div class="tour__proofs">${proofs}</div>
        <figure
          class="tour__proofterm"
          data-reveal
          style="--reveal-delay: 200ms"
          aria-label="Terminal session proving the shell is untouched"
        >
          <div class="tour__proofterm-head" aria-hidden="true">
            <i></i>zsh — ${BRAND.slug}
          </div>
          <div class="tour__proofterm-body" data-proof-term aria-hidden="true"></div>
        </figure>
      </div>
      <div class="tour__shortcuts" data-reveal style="--reveal-delay: 120ms">${shortcuts}</div>
      <div class="tour__ctas" data-reveal style="--reveal-delay: 220ms">
        <a
          class="tour__cta tour__cta--primary"
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
          <span aria-hidden="true">↓</span>
        </a>
        <!-- Mirrors the hero: a disabled button, so it is neither pressable nor
             a target for upgradeReleaseLinks' anchor retargeting. -->
        <button class="tour__cta" type="button" disabled>
          <span class="a-cta-lead">
            ${renderAppleIcon()}
            <span data-copy="downloadMac">${copy.downloadMac}</span>
          </span>
          <span class="a-cta-tag" data-copy="comingSoon"
            >${copy.comingSoon}</span
          >
        </button>

        <p class="a-cta-note" data-copy="winUnsignedNote">
          ${copy.winUnsignedNote}
        </p>
        <a
          class="tour__cta"
          href="${REPO_URL}"
          target="_blank"
          rel="noreferrer"
        >
          <span data-copy="secondaryCta">${copy.secondaryCta}</span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </footer>
  `;
}

function renderFooter(copy) {
  return `
    <footer class="site-footer">
      <div class="site-footer__glow" aria-hidden="true"></div>
      <div class="site-footer__inner">
        <div class="site-footer__brand">
          <span class="site-footer__mark">
            <img src="${BRAND_ICON_SRC}" alt="" width="30" height="30" />
            <strong data-copy="navProduct">${copy.navProduct}</strong>
          </span>
          <p class="site-footer__tagline" data-copy="footerTagline">${copy.footerTagline}</p>
        </div>
        <nav class="site-footer__col" aria-label="${copy.footerColProduct}">
          <span class="site-footer__coltitle" data-copy="footerColProduct">${copy.footerColProduct}</span>
          <a href="${WINDOWS_FALLBACK_URL}" target="_blank" rel="noreferrer" data-copy="downloadWin">${copy.downloadWin}</a>
          <a class="site-footer__link" href="#${FEATURES_ID}" data-copy="seeFeatures">${copy.seeFeatures}</a>
        </nav>
        <nav class="site-footer__col" aria-label="${copy.footerColProject}">
          <span class="site-footer__coltitle" data-copy="footerColProject">${copy.footerColProject}</span>
          <a href="${REPO_URL}" target="_blank" rel="noreferrer" data-copy="navGithub">${copy.navGithub}</a>
          <a href="${REPO_URL}/releases" target="_blank" rel="noreferrer" data-copy="footerReleases">${copy.footerReleases}</a>
          <a href="${REPO_URL}/issues" target="_blank" rel="noreferrer" data-copy="footerIssues">${copy.footerIssues}</a>
          <a href="${REPO_URL}/blob/main/LICENSE" target="_blank" rel="noreferrer" data-copy="footerLicense">${copy.footerLicense}</a>
        </nav>
      </div>
      <div class="site-footer__base">
        <span>© 2026 mxrsv</span>
        <span class="site-footer__built" data-copy="footerBuilt">${copy.footerBuilt}</span>
      </div>
    </footer>
  `;
}

export function renderTour(copy) {
  return {
    markup: `
      <section class="tour">
        <div class="panels" id="${FEATURES_ID}">
          <p class="band-label" data-copy="tourKicker">${copy.tourKicker}</p>
          ${PANELS.map((panel, index) => renderPanel(panel, index, copy)).join("")}
        </div>
        ${renderFinale(copy)}
        ${renderFooter(copy)}
      </section>
    `,
    mount(root) {
      const section = root.querySelector(".tour");

      if (!section) {
        throw new Error("Tour root is missing.");
      }

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );

      const disposeReveal = mountFinaleReveal(section);
      const disposeProofTerm = mountProofTerm(section, reduceMotion);

      return () => {
        disposeProofTerm();
        disposeReveal();
      };
    },
  };
}

/**
 * Swap localized tour copy in place (same reasoning as the hero: keep the DOM,
 * the proof terminal's timers, and scroll state alive across a locale
 * toggle).
 *
 * @param {Element} root
 * @param {Record<string, string>} copy
 */
export function updateTourLocale(root, copy) {
  const section = root.querySelector(".tour");

  if (!section) {
    throw new Error("Tour root is missing.");
  }

  for (const node of section.querySelectorAll("[data-copy]")) {
    const text = copy[node.dataset.copy];

    if (typeof text === "string") {
      node.textContent = text;
    }
  }
}
