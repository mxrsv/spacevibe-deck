/**
 * Scroll tour — a real ".a-appwin" window (same chrome as the hero stage,
 * live transcripts included) sticky at viewport center, morphing through
 * three chapters as the visitor scrolls, over an aurora curtain whose palette
 * follows the chapter. Native scroll only — no wheel hijacking.
 */

import {
  BRAND_ICON_SRC,
  renderStagePane,
  renderStageSidebar,
  renderStageStatus,
  renderStageTitlebar,
} from "../appwin.js";
import { BRAND, STAGE_ARIA_LABEL } from "../../../stage/brand.js";
import { mountAurora } from "../aurora.js";
import { mountStageStream, stagePanes } from "../product-stage.js";
import {
  AGENTS,
  AURORA_SCENES,
  PRESET_CELLS,
  PROOF_TERM_STEPS,
  SIDEBAR_STATUS,
  boardRecents,
} from "./stage-states.js";
import {
  CHAPTER_COUNT,
  chapterForProgress,
  trackProgress,
} from "./scroll-progress.js";

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

/** One-shot scale/opacity-in the first time the tour window enters view. */
function mountWindowEntrance(section, reduceMotion) {
  const figure = section.querySelector(".tour__appwin");

  if (!figure) {
    throw new Error("Tour window markup is missing.");
  }

  if (reduceMotion.matches) {
    figure.classList.add("is-entered");
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-entered");
          observer.disconnect();
        }
      }
    },
    { threshold: 0.3 },
  );
  observer.observe(figure);

  return () => observer.disconnect();
}

/**
 * Below 768px, un-pin the window and freeze it in the chapter-3 payoff state
 * (the CSS handles the static layout). Above it, hand control back to scroll.
 */
function mountResponsiveMode(section, update, aurora) {
  const narrow = window.matchMedia("(max-width: 768px)");

  function apply() {
    if (narrow.matches) {
      section.classList.add("tour--static");
      section.dataset.chapter = "3";
      aurora.setScene(AURORA_SCENES[3]);
    } else {
      section.classList.remove("tour--static");
      update();
    }
  }

  apply();
  narrow.addEventListener("change", apply);

  return () => narrow.removeEventListener("change", apply);
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

function renderChapterRail(copy) {
  const chapters = [1, 2, 3]
    .map(
      (n) => `
        <button type="button" class="tour__chapter" data-ch="${n}">
          <span class="tour__chapnum">0${n}</span>
          <span class="tour__chaptext">
            <strong data-copy="tourCh${n}Title">${copy[`tourCh${n}Title`]}</strong>
            <span data-copy="tourCh${n}Body">${copy[`tourCh${n}Body`]}</span>
          </span>
        </button>
      `,
    )
    .join("");

  return `
    <aside class="tour__rail">
      <span class="tour__kicker" data-copy="tourKicker">${copy.tourKicker}</span>
      ${chapters}
    </aside>
  `;
}

function renderAgentChip(agentId) {
  const agent = AGENTS[agentId];

  return `<span class="tour__agentchip" style="--chip-tint: ${agent.tint}">${agent.monogram}</span>`;
}

function renderPresetThumb(preset) {
  const cells = "<i></i>".repeat(PRESET_CELLS[preset]);

  return `<span class="tour__thumb" data-preset="${preset}">${cells}</span>`;
}

function renderBoardRecent(row) {
  return `
    <div class="tour__recent${row.highlighted ? " is-hot" : ""}">
      ${renderPresetThumb(row.preset)}
      <span class="tour__rectext">
        <strong>${row.label}</strong>
        <span>${row.path}</span>
      </span>
      <span class="tour__recagents">${row.agents.map(renderAgentChip).join("")}</span>
      ${row.highlighted ? '<kbd class="tour__openkbd">↵ Open</kbd>' : ""}
    </div>
  `;
}

/** Open board main area (chapter 1) — the sidebar persists across scenes. */
function renderBoard() {
  return `
    <div class="tour__board">
      <div class="tour__boardlogo">
        <img src="${BRAND_ICON_SRC}" alt="" />
        <span>${BRAND.name}</span>
      </div>
      <div class="tour__recents">${boardRecents.map(renderBoardRecent).join("")}</div>
    </div>
  `;
}

function renderStage() {
  const [claudePane, codexPane, opencodePane] = stagePanes;

  return `
    <figure class="a-appwin tour__appwin" data-enter role="img" aria-label="${STAGE_ARIA_LABEL}">
      ${renderStageTitlebar()}
      <div class="a-appwin__body" aria-hidden="true">
        ${renderStageSidebar(SIDEBAR_STATUS)}
        <div class="tour__scene">
          ${renderBoard()}
          <div class="a-appwin__grid tour__scenegrid">
            <div class="a-appwin__col">
              ${renderStagePane(claudePane)}
              ${renderStagePane(codexPane)}
            </div>
            ${renderStagePane(opencodePane)}
          </div>
        </div>
      </div>
      ${renderStageStatus()}
    </figure>
  `;
}

function renderFinale(copy) {
  const proofs = ["Pty", "Local", "Native"]
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
      <h2 data-reveal data-copy="finaleTitle">${copy.finaleTitle}</h2>
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
          href="https://github.com/mxrsv/spacevibe-deck/releases/latest"
          target="_blank"
          rel="noreferrer"
        >
          <span data-copy="finaleDownload">${copy.finaleDownload}</span>
          <span aria-hidden="true">↓</span>
        </a>
        <button class="tour__cta" type="button" data-open-demo>
          <span data-copy="primaryCta">${copy.primaryCta}</span>
        </button>
        <a
          class="tour__cta"
          href="https://github.com/mxrsv/spacevibe-deck"
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

const REPO = "https://github.com/mxrsv/spacevibe-deck";

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
          <a href="${REPO}/releases/latest" target="_blank" rel="noreferrer" data-copy="finaleDownload">${copy.finaleDownload}</a>
          <button type="button" class="site-footer__link" data-open-demo data-copy="primaryCta">${copy.primaryCta}</button>
        </nav>
        <nav class="site-footer__col" aria-label="${copy.footerColProject}">
          <span class="site-footer__coltitle" data-copy="footerColProject">${copy.footerColProject}</span>
          <a href="${REPO}" target="_blank" rel="noreferrer" data-copy="navGithub">${copy.navGithub}</a>
          <a href="${REPO}/releases" target="_blank" rel="noreferrer" data-copy="footerReleases">${copy.footerReleases}</a>
          <a href="${REPO}/issues" target="_blank" rel="noreferrer" data-copy="footerIssues">${copy.footerIssues}</a>
          <a href="${REPO}/blob/main/LICENSE" target="_blank" rel="noreferrer" data-copy="footerLicense">${copy.footerLicense}</a>
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
      <section class="tour" data-chapter="1">
        <div class="tour__track">
          <div class="tour__sticky">
            <div class="tour__motion" aria-hidden="true"></div>
            <div class="tour__layout">
              ${renderChapterRail(copy)}
              ${renderStage()}
            </div>
          </div>
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

      const track = section.querySelector(".tour__track");
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );

      const aurora = mountAurora(
        section.querySelector(".tour__motion"),
        AURORA_SCENES[1],
      );
      const disposeStream = mountStageStream(
        section.querySelector(".tour__scenegrid"),
      );
      const disposeReveal = mountFinaleReveal(section);
      const disposeProofTerm = mountProofTerm(section, reduceMotion);
      const disposeEntrance = mountWindowEntrance(section, reduceMotion);

      let rafId = null;

      function update() {
        rafId = null;

        if (section.classList.contains("tour--static")) {
          return;
        }

        const rect = track.getBoundingClientRect();
        const progress = trackProgress(
          rect.top,
          rect.height,
          window.innerHeight,
        );

        if (rect.height - window.innerHeight <= 0) {
          return;
        }

        const chapter = String(chapterForProgress(progress));

        if (section.dataset.chapter !== chapter) {
          section.dataset.chapter = chapter;
          aurora.setScene(AURORA_SCENES[chapter]);
        }
      }

      function schedule() {
        if (rafId === null) {
          rafId = requestAnimationFrame(update);
        }
      }

      function handleRailClick(event) {
        if (section.classList.contains("tour--static")) {
          return;
        }

        const button = event.target.closest(".tour__chapter");

        if (!button || !section.contains(button)) {
          return;
        }

        const rect = track.getBoundingClientRect();
        const scrollable = rect.height - window.innerHeight;
        const index = Number(button.dataset.ch) - 1;
        const target =
          window.scrollY +
          rect.top +
          scrollable * ((index + 0.5) / CHAPTER_COUNT);

        window.scrollTo({
          top: target,
          behavior: reduceMotion.matches ? "auto" : "smooth",
        });
      }

      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule, { passive: true });
      section.addEventListener("click", handleRailClick);
      const disposeResponsive = mountResponsiveMode(section, update, aurora);

      return () => {
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        section.removeEventListener("click", handleRailClick);

        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }

        disposeResponsive();
        disposeEntrance();
        disposeProofTerm();
        disposeReveal();
        disposeStream();
        aurora.dispose();
      };
    },
  };
}

/**
 * Swap localized tour copy in place (same reasoning as the hero: keep the DOM,
 * stream timers, and scroll state alive across a locale toggle).
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
