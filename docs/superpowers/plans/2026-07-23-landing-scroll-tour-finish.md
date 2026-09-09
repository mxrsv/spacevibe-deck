# Landing Scroll Tour — Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the approved scroll-tour + closing-band + footer mock in `marketing/landing-prototype/` from prototype fidelity to production-ready: extract testable scroll logic, add the window entrance animation, finalize bilingual copy, ship a proper narrow-screen fallback, and de-duplicate the design tokens — without changing the shipped hero's look.

**Architecture:** The tour is a plain-DOM ES module (`src/tour/`) rendered after the hero into `#specimen-root`; a sticky `.a-appwin` window morphs through three chapters driven by native scroll progress, over a per-chapter aurora curtain (`src/aurora.js` `setScene`), with a CSS-bloom + footer closing region. This plan pulls the scroll→chapter math into a pure, unit-tested helper, then layers polish (entrance, mobile, tokens) as independently reviewable tasks.

**Tech Stack:** Vanilla ES modules, Vite 6 dev server, plain CSS (container queries + `svh` + `prefers-reduced-motion`), `ogl` WebGL aurora, Vitest 3 (node env) for pure-logic tests.

## Global Constraints

- **Do not modify the hero's rendered look.** `src/directions/a.js` and the hero portion of `styles/direction-a.css` are shipped/approved after 7 review rounds; token extraction must be visually pixel-equivalent for the hero.
- **Inside the app window is English-only** — mirrors the released app regardless of landing locale. No Vietnamese or CJK in stage/board/pane/terminal text.
- **Bilingual EN/VI outside the window** via the existing `data-copy` swap; Vietnamese is natural product copy, not word-for-word, with full diacritics.
- **Respect `prefers-reduced-motion: reduce`** on every animation added: freeze/still, never hidden or broken.
- **No wheel hijacking / scroll snapping** — native scroll only; a passive `scroll` + rAF maps progress.
- **Commit path-limited** to `marketing/landing-prototype/**` (shared checkout, concurrent agents); never rewrite history.
- **Verification is by eye** for visual work (per the 2026-07-10 funnel rule): the reviewer looks at `http://127.0.0.1:5173/landing-prototype/` (`npm run prototype:landing`). A green build is evidence, never proof.
- Dev server: `npm run prototype:landing` (Vite, 127.0.0.1:5173, `--open /landing-prototype/`).

---

## File Structure

- `src/tour/scroll-progress.js` (NEW) — pure track-progress + chapter math, no DOM.
- `src/tour/scroll-progress.test.js` (NEW) — Vitest unit tests (node env).
- `src/tour/index.js` (MODIFY) — consume the helper; window entrance observer; narrow-screen static branch.
- `src/tour/stage-states.js` (MODIFY) — align the board's third agent with the rendered panes (opencode, not gemini).
- `src/copy.js` (MODIFY) — finalize the tour/finale/footer EN/VI copy only; hero keys stay frozen (see Task 5).
- `styles/tokens.css` (NEW) — shared design tokens (surfaces, violet accent, fonts, Tokyo Night chrome vars).
- `styles/direction-a.css` (MODIFY) — consume `tokens.css` for the shared vars (hero look unchanged).
- `styles/tour.css` (MODIFY) — consume `tokens.css`; entrance animation; static narrow-screen layout.
- `src/main.js` (MODIFY) — import `tokens.css` first.
- `vite.build.mjs` (NEW, under `marketing/landing-prototype/`) — landing-only Vite production config used by the final build gate (Task 7). Kept inside the prototype folder so it stays within the path-limited commit scope and is never auto-loaded by the `vite marketing` dev server.
- `docs/superpowers/specs/2026-07-23-landing-scroll-tour-design.md` (MODIFY) — tick off open items as they land (note: `docs/superpowers/` is gitignored — on-disk only).

---

### Task 1: Extract pure scroll-progress logic (with tests)

Pull the inline scroll math out of `mount()` into a pure module so it is unit-testable and reused by the entrance/mobile tasks. No behavior change.

**Files:**
- Create: `marketing/landing-prototype/src/tour/scroll-progress.js`
- Test: `marketing/landing-prototype/src/tour/scroll-progress.test.js`
- Modify: `marketing/landing-prototype/src/tour/index.js`

**Interfaces:**
- Produces: `CHAPTER_COUNT: number` (=3); `trackProgress(topPx: number, trackHeightPx: number, viewportPx: number): number` returning 0..1; `chapterForProgress(progress: number, chapterCount?: number): number` returning a 1-based index in `[1, chapterCount]`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
// marketing/landing-prototype/src/tour/scroll-progress.test.js
import { describe, expect, it } from "vitest";
import {
  CHAPTER_COUNT,
  chapterForProgress,
  trackProgress,
} from "./scroll-progress.js";

describe("trackProgress", () => {
  it("is 0 before the track scrolls under the top", () => {
    // top still positive (track below the viewport top) → clamped to 0
    expect(trackProgress(200, 3400, 800)).toBe(0);
  });

  it("is 1 once scrolled past the end", () => {
    // -top exceeds the scrollable distance (3400 - 800 = 2600)
    expect(trackProgress(-3000, 3400, 800)).toBe(1);
  });

  it("is linear in the middle", () => {
    // -top / (height - viewport) = 1300 / 2600 = 0.5
    expect(trackProgress(-1300, 3400, 800)).toBeCloseTo(0.5, 5);
  });

  it("returns 0 when the track is not taller than the viewport", () => {
    expect(trackProgress(-10, 800, 800)).toBe(0);
  });
});

describe("chapterForProgress", () => {
  it("maps the three thirds to chapters 1..3", () => {
    expect(chapterForProgress(0)).toBe(1);
    expect(chapterForProgress(0.2)).toBe(1);
    expect(chapterForProgress(0.34)).toBe(2);
    expect(chapterForProgress(0.67)).toBe(3);
    expect(chapterForProgress(1)).toBe(3);
  });

  it("clamps out-of-range input", () => {
    expect(chapterForProgress(-5)).toBe(1);
    expect(chapterForProgress(9)).toBe(3);
  });

  it("honours a custom chapter count", () => {
    expect(chapterForProgress(0.5, 4)).toBe(3);
  });

  it("exports the default chapter count", () => {
    expect(CHAPTER_COUNT).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run marketing/landing-prototype/src/tour/scroll-progress.test.js`
Expected: FAIL — `Failed to resolve import "./scroll-progress.js"` / module not found.

- [ ] **Step 3: Write the minimal implementation**

```js
// marketing/landing-prototype/src/tour/scroll-progress.js
/**
 * Pure scroll→chapter math for the tour. No DOM access, so the sticky
 * mapping stays unit-testable and can be reused by the entrance/mobile code.
 */

export const CHAPTER_COUNT = 3;

/**
 * Fraction (0..1) of the sticky track that has scrolled under the viewport
 * top. `topPx` is the track's getBoundingClientRect().top.
 */
export function trackProgress(topPx, trackHeightPx, viewportPx) {
  const scrollable = trackHeightPx - viewportPx;

  if (scrollable <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, -topPx / scrollable));
}

/** Map a 0..1 progress to a 1-based chapter index in [1, chapterCount]. */
export function chapterForProgress(progress, chapterCount = CHAPTER_COUNT) {
  const clamped = Math.min(1, Math.max(0, progress));

  return Math.min(chapterCount, Math.floor(clamped * chapterCount) + 1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run marketing/landing-prototype/src/tour/scroll-progress.test.js`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Refactor `index.js` to use the helper**

In `marketing/landing-prototype/src/tour/index.js`, replace the local `CHAPTER_COUNT` constant and the inline math in `update()` / `handleRailClick()`.

Add to the import block (near the other `./` imports):

```js
import {
  CHAPTER_COUNT,
  chapterForProgress,
  trackProgress,
} from "./scroll-progress.js";
```

Remove the existing `const CHAPTER_COUNT = 3;` line in `index.js` (now imported).

Replace the body of `update()`:

```js
      function update() {
        rafId = null;

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
```

Replace the offset math in `handleRailClick()`:

```js
      function handleRailClick(event) {
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
```

- [ ] **Step 6: Verify the tour still behaves (build + eye-review)**

Run: `node --check marketing/landing-prototype/src/tour/index.js`
Expected: no output (syntax OK). Then with `npm run prototype:landing` running, scroll the tour: chapters still switch 1→2→3 and rail clicks still jump. Confirm no console errors.

- [ ] **Step 7: Commit**

```bash
git add marketing/landing-prototype/src/tour/scroll-progress.js marketing/landing-prototype/src/tour/scroll-progress.test.js marketing/landing-prototype/src/tour/index.js
git commit -m "refactor(landing): extract pure scroll-progress helper + tests"
```

---

### Task 2: Align the board's third agent with the rendered panes

Chapter 1's Open board advertises `claude / codex / gemini`, but chapters 2–3 render `claude / codex / opencode` (the shared hero panes). Fix the narrative inconsistency by making the board show `opencode`.

**Files:**
- Modify: `marketing/landing-prototype/src/tour/stage-states.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AGENTS` keyed by `claude`, `codex`, `opencode`; `boardRecents[0].agents = ["claude", "codex", "opencode"]`.

- [ ] **Step 1: Rename the agent in `AGENTS`**

In `marketing/landing-prototype/src/tour/stage-states.js`, change the `AGENTS` map's `gemini` entry to `opencode` (keep the cyan tint, which matches the hero's third pane accent):

```js
export const AGENTS = deepFreeze({
  claude: { monogram: "C", tint: "#bb9af7" },
  codex: { monogram: "X", tint: "#9ece6a" },
  opencode: { monogram: "O", tint: "#7dcfff" },
});
```

- [ ] **Step 2: Update the highlighted recent row**

In the same file, change the first `boardRecents` entry's `agents` array:

```js
    agents: ["claude", "codex", "opencode"],
```

- [ ] **Step 3: Verify no stale `gemini` reference remains**

Run: `grep -rn "gemini" marketing/landing-prototype/src`
Expected: no matches.

- [ ] **Step 4: Build + eye-review**

Run: `node --check marketing/landing-prototype/src/tour/stage-states.js`
Expected: no output. With the dev server running, confirm chapter 1's third agent chip now reads `O` (cyan) and matches the third pane's `opencode` header in chapters 2–3.

- [ ] **Step 5: Commit**

```bash
git add marketing/landing-prototype/src/tour/stage-states.js
git commit -m "fix(landing): board agent trio matches rendered panes (opencode)"
```

---

### Task 3: Window entrance animation (scale-in on first view)

The tour window currently just appears. Add a one-shot scale/opacity-in the first time the window enters the viewport. Reduced motion shows it resolved instantly.

**Files:**
- Modify: `marketing/landing-prototype/src/tour/index.js`
- Modify: `marketing/landing-prototype/styles/tour.css`

**Interfaces:**
- Consumes: the existing `reduceMotion` MediaQueryList in `mount()`.
- Produces: a `mountWindowEntrance(section, reduceMotion): () => void` local helper; the window figure carries `data-enter` and gains `is-entered`.

- [ ] **Step 1: Add the `data-enter` hook to the window markup**

In `renderStage()` in `index.js`, add `data-enter` to the figure:

```js
    <figure class="a-appwin tour__appwin" data-enter role="img" aria-label="Stackgrid app window tour preview">
```

- [ ] **Step 2: Add the entrance helper and wire it in `mount()`**

Add this helper near `mountFinaleReveal` in `index.js`:

```js
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
```

In `mount()`, after `const disposeProofTerm = mountProofTerm(section, reduceMotion);`, add:

```js
      const disposeEntrance = mountWindowEntrance(section, reduceMotion);
```

In the returned disposer, add `disposeEntrance();` alongside the other disposers.

- [ ] **Step 3: Add the entrance CSS**

In `marketing/landing-prototype/styles/tour.css`, after the `.tour__layout .a-appwin` rule, add:

```css
/* Window entrance — scale/opacity-in on first view (Task 3). */
.tour__appwin[data-enter] {
  opacity: 0;
  transform: translateY(2.2rem) scale(0.965);
  transition:
    opacity 760ms ease,
    transform 760ms cubic-bezier(0.22, 0.78, 0.18, 1);
}

.tour__appwin[data-enter].is-entered {
  opacity: 1;
  transform: none;
}
```

The existing `@media (prefers-reduced-motion: reduce)` block already zeroes `.tour *` transitions, and Step 2 adds `is-entered` immediately under reduced motion, so the window shows resolved with no motion.

- [ ] **Step 4: Build + eye-review**

Run: `node --check marketing/landing-prototype/src/tour/index.js`
Expected: no output. Reload the page and scroll to the tour: the window should rise + scale in once. Toggle OS reduce-motion and confirm it appears instantly with no transform.

- [ ] **Step 5: Commit**

```bash
git add marketing/landing-prototype/src/tour/index.js marketing/landing-prototype/styles/tour.css
git commit -m "feat(landing): tour window scale-in on first view"
```

---

### Task 4: Narrow-screen static fallback

On phones the sticky, scroll-morphing window is cramped and fragile. Below 768px, un-pin the window, show it once in the fully-expanded (chapter-3) state, and present the three chapter blurbs as a normal stacked list. Driven by `matchMedia`, so resizing across the breakpoint re-wires cleanly.

**Files:**
- Modify: `marketing/landing-prototype/src/tour/index.js`
- Modify: `marketing/landing-prototype/styles/tour.css`

**Interfaces:**
- Consumes: `CHAPTER_COUNT` (unused here) and the existing scroll `schedule`/`update` wiring.
- Produces: a `mountResponsiveMode(section, update): () => void` helper that toggles `.tour--static` on the section and forces `data-chapter="3"` while static.

- [ ] **Step 1: Add the responsive-mode helper**

In `index.js`, add near the other mount helpers:

```js
/**
 * Below 768px, un-pin the window and freeze it in the chapter-3 payoff state
 * (the CSS handles the static layout). Above it, hand control back to scroll.
 */
function mountResponsiveMode(section, update) {
  const narrow = window.matchMedia("(max-width: 768px)");

  function apply() {
    if (narrow.matches) {
      section.classList.add("tour--static");
      section.dataset.chapter = "3";
    } else {
      section.classList.remove("tour--static");
      update();
    }
  }

  apply();
  narrow.addEventListener("change", apply);

  return () => narrow.removeEventListener("change", apply);
}
```

- [ ] **Step 2: Gate the scroll handler and wire the helper**

In `update()` in `index.js`, bail out while static — add it **immediately after the `rafId = null;` line** (Task 1's refactored `update()` starts with `rafId = null;`, so the rAF slot is always cleared before we bail):

```js
        rafId = null;

        if (section.classList.contains("tour--static")) {
          return;
        }
```

**Wiring order matters (avoids a temporal-dead-zone crash).** `mountResponsiveMode` calls `apply()` synchronously in its constructor, and on desktop `apply()` calls `update()`, whose first statement assigns `rafId`. So the helper must be wired **after** `let rafId = null;` is initialized — wiring it up near `disposeProofTerm` (before `let rafId`) throws `ReferenceError: Cannot access 'rafId' before initialization`.

Concretely: in `mount()`, **replace the standalone initial `update();` call** (the line just before the returned disposer) with:

```js
      const disposeResponsive = mountResponsiveMode(section, update);
```

This is safe because `mountResponsiveMode`'s `apply()` performs the initial sync itself — on desktop it calls `update()` (same first-paint behavior as the old `update();`), and on narrow it sets the static payoff state. Do **not** also keep the old `update();`; the helper subsumes it.

Add `disposeResponsive();` to the returned disposer.

- [ ] **Step 3: Add the static-layout CSS**

In `tour.css`, inside the existing `@media (max-width: 768px)` block, add rules that un-pin and force the payoff view.

**Specificity note (this is why the naive rules fail).** `apply()` forces `data-chapter="3"`, which activates the existing chapter-3 rules: `.tour[data-chapter="3"] .tour__board { opacity: 0 }`, `.tour[data-chapter="3"] .tour__scenegrid { grid-template-columns: 65fr 35fr }` — each at specificity `(0,3,0)`. A plain `.tour--static .tour__board { … }` is only `(0,2,0)` and **loses**, so the board stays invisible and the grid stays two-column. The static rules that fight a chapter-3 rule must double the class (`.tour.tour--static …` → `(0,3,0)`, tying and winning on source order). Two more existing rules must also be overridden explicitly: the narrow-screen `.tour__chaptext span { display: none }` (hides the blurb bodies) and `.a-appwin { aspect-ratio: 1000 / 620; overflow: hidden }` (clips the now-taller stacked content).

```css
  /* Un-pin the track + sticky so the window flows in normal document order. */
  .tour--static .tour__track {
    height: auto;
  }

  .tour--static .tour__sticky {
    position: static;
    height: auto;
    padding-block: 2.5rem;
    overflow: visible;
  }

  /* The .a-appwin chrome is aspect-ratio locked + overflow:hidden for the
     morph. Un-lock it so the stacked board + grid are not clipped. */
  .tour--static .tour__appwin {
    aspect-ratio: auto;
    overflow: visible;
  }

  /* Show the board scene AND the grid stacked (they normally share one grid
     cell for the crossfade), so the whole story reads without scroll-morphing. */
  .tour--static .tour__scene {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Doubled `.tour.tour--static` ties the chapter-3 rules' (0,3,0) specificity
     and wins on source order — force both scenes visible and still. */
  .tour.tour--static .tour__board,
  .tour.tour--static .tour__scenegrid {
    position: static;
    opacity: 1;
    transform: none;
  }

  .tour.tour--static .tour__scenegrid {
    grid-template-columns: 1fr;
  }

  /* Present the three chapter blurbs as a readable stacked list — the base
     narrow rule scrolls the rail horizontally and hides the blurb bodies. */
  .tour--static .tour__rail {
    flex-direction: column;
    overflow: visible;
  }

  .tour--static .tour__chaptext span {
    display: block;
  }
```

- [ ] **Step 4: Build + eye-review at mobile width**

Run: `node --check marketing/landing-prototype/src/tour/index.js`
Expected: no output. In the browser devtools, set width to ~390px: the window should sit un-pinned, the board + grid stacked, all three chapter blurbs readable as a list, and vertical scrolling smooth (no pin/jump). Resize back to desktop and confirm the scroll morph returns.

- [ ] **Step 5: Commit**

```bash
git add marketing/landing-prototype/src/tour/index.js marketing/landing-prototype/styles/tour.css
git commit -m "feat(landing): static un-pinned tour fallback below 768px"
```

---

### Task 5: Finalize bilingual copy (EN/VI)

Replace first-draft strings with final product copy and confirm the constraints (natural VI with diacritics, English-only inside the window).

**Files:**
- Modify: `marketing/landing-prototype/src/copy.js`

**Interfaces:**
- Consumes/Produces: same `messages.en` / `messages.vi` keys already referenced by `directions/a.js` and `tour/index.js` (`tourKicker`, `tourCh{1,2,3}{Title,Body}`, `finaleTitle`, `proof{Pty,Local,Native}{Title,Body}`, `sc{Split,SplitH,Tab,Expand,Find,Clear}`, `finaleDownload`, `footerTagline`, `footerColProduct`, `footerColProject`, `footerReleases`, `footerIssues`, `footerLicense`, `footerBuilt`). Do not rename keys.

- [ ] **Step 1: Verify constraints and finalize only the in-scope keys**

**In scope (tour + finale + footer only):** `tourKicker`, `tourCh{1,2,3}{Title,Body}`, `finaleTitle`, `proof{Pty,Local,Native}{Title,Body}`, `sc{Split,SplitH,Tab,Expand,Find,Clear}`, `finaleDownload`, `footerTagline`, `footerColProduct`, `footerColProject`, `footerReleases`, `footerIssues`, `footerLicense`, `footerBuilt`.

**FROZEN — do NOT edit (hero/shared, shipped after 7 review rounds):** `headlineLead`, `headlineTail`, `subhead`, `primaryCta`, `secondaryCta`, `navProduct`, `navGithub`, `localeLabel`. These are rendered by the hero (`directions/a.js`); `primaryCta`/`secondaryCta`/`navProduct`/`navGithub` are additionally reused by the tour finale + footer, so editing them would change the hero's rendered text. Changing any of these violates the "do not modify the hero" constraint. Leave both the `en` and `vi` values byte-for-byte identical.

Read `marketing/landing-prototype/src/copy.js` and confirm, **for the in-scope keys only**: (a) EN reads as shipped product copy, (b) VI is natural and fully accented, (c) nothing inside-the-window is translated (there is none in `copy.js` — the stage/board/terminal text lives in `stage-states.js` and is English-only). The current strings already read as final product copy, so this is expected to be a near-noop: only correct a **specific, concrete defect** (a typo, a missing diacritic, an EN/VI mismatch in meaning) in an in-scope key. Do not rewrite well-formed copy on taste. Keep every key name and its meaning identical to avoid breaking the renderers.

- [ ] **Step 2: Verify structural parity + no CJK**

Run: `node -e "const {messages}=require('./marketing/landing-prototype/src/copy.js'); const a=Object.keys(messages.en).sort(), b=Object.keys(messages.vi).sort(); console.log(JSON.stringify(a)===JSON.stringify(b)?'KEYS MATCH':'KEY MISMATCH');"`
Expected: `KEYS MATCH`. (If it errors on ESM, instead eyeball that every `en` key has a `vi` twin.)

Run: `grep -rnP '[\x{4e00}-\x{9fff}\x{3040}-\x{30ff}]' marketing/landing-prototype/src/copy.js || echo "no CJK"`
Expected: `no CJK`.

- [ ] **Step 3: Eye-review both locales**

With the dev server running, toggle EN/VI in the topbar and read the tour rail, proof chips, shortcut labels, CTAs, and footer in both languages. Confirm nothing overflows or reads awkwardly.

- [ ] **Step 4: Commit**

```bash
git add marketing/landing-prototype/src/copy.js
git commit -m "copy(landing): finalize EN/VI tour + footer strings"
```

---

### Task 6: Extract shared design tokens

Both `direction-a.css` and `tour.css` redefine the same values (violet accent, surfaces, fonts, Tokyo Night chrome vars). Centralize them so the tour and hero stay in lockstep. The hero's rendered look must not change.

**Files:**
- Create: `marketing/landing-prototype/styles/tokens.css`
- Modify: `marketing/landing-prototype/styles/direction-a.css`
- Modify: `marketing/landing-prototype/styles/tour.css`
- Modify: `marketing/landing-prototype/src/main.js`

**Interfaces:**
- Produces: `:root` custom properties consumed by both stylesheets — `--sg-*` (Tokyo Night window chrome), the shared violet `--accent`/`--accent-rgb` value `#b98cff` / `185 140 255`, and the shared font stacks `--font-display` / `--font-mono`.
- Consumes: nothing.

- [ ] **Step 1: Capture the hero baseline (for the visual-equivalence check)**

With the dev server running, note the hero's current look (accent color of the CTA, window chrome, headline font). This is the reference Step 5 must match — the hero must look identical after the refactor.

- [ ] **Step 2: Create `tokens.css` with the shared values**

```css
/* Shared design tokens for the landing prototype. Values lifted verbatim
   from direction-a.css so the hero renders identically; tour.css consumes
   the same set to stay in lockstep. */

:root {
  /* Violet signal colour (CTA, focus, live status). */
  --accent: #b98cff;
  --accent-rgb: 185 140 255;

  /* Font language — one system sans for text + chrome, mono for terminal. */
  --font-display:
    -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  --font-mono:
    "SF Mono", "JetBrains Mono", ui-monospace, "Cascadia Code", Menlo, monospace;

  /* Tokyo Night app-window chrome (shared by .a-appwin in hero + tour). */
  --sg-bg: #16161e;
  --sg-fg: #c0caf5;
  --sg-fg-dim: color-mix(in srgb, #c0caf5 62%, transparent);
  --sg-fg-faint: color-mix(in srgb, #c0caf5 40%, transparent);
  --sg-accent: #7aa2f7;
  --sg-green: #9ece6a;
  --sg-yellow: #e0af68;
  --sg-purple: #bb9af7;
  --sg-hairline: color-mix(in srgb, #c0caf5 14%, transparent);
  --sg-hairline-soft: color-mix(in srgb, #c0caf5 8%, transparent);
}
```

- [ ] **Step 3: Import `tokens.css` first in `main.js`**

In `marketing/landing-prototype/src/main.js`, add as the FIRST import (before `direction-a.css`):

```js
import "../styles/tokens.css";
```

- [ ] **Step 4: Point both stylesheets at the shared tokens**

In `styles/direction-a.css`, in the `.a-appwin` block, delete the nine `--sg-*` local definitions (now in `tokens.css`); the `var(--sg-*)` references already resolve from `:root`. Leave every other hero value untouched.

In `styles/tour.css`, in the `.tour` block, replace the local aliases so they reference the shared tokens instead of re-hardcoding:

```css
  --a-font-display: var(--font-display);
  --a-font-mono: var(--font-mono);
```

Keep `--t-accent`/`--t-accent-rgb` but source them from the shared token:

```css
  --t-accent: var(--accent);
  --t-accent-rgb: var(--accent-rgb);
```

Leave the `--sg-*` references in `tour.css` (they now resolve from `:root`).

- [ ] **Step 5: Verify hero is visually unchanged + tour intact**

Run: `node --check marketing/landing-prototype/src/main.js`
Expected: no output. With the dev server running, compare the hero against the Step 1 baseline: CTA accent, window chrome, fonts must be identical. Then scroll the tour + closing band and confirm nothing shifted color or font.

- [ ] **Step 6: Commit**

```bash
git add marketing/landing-prototype/styles/tokens.css marketing/landing-prototype/styles/direction-a.css marketing/landing-prototype/styles/tour.css marketing/landing-prototype/src/main.js
git commit -m "refactor(landing): share design tokens across hero + tour"
```

---

### Task 7: Harden pass — reduced motion, a11y, performance, full review

Final integration gate over the whole landing (hero → tour → closing → footer).

**Files:**
- Modify (only if the review finds gaps): `marketing/landing-prototype/styles/tour.css`, `marketing/landing-prototype/src/tour/index.js`
- Modify: `docs/superpowers/specs/2026-07-23-landing-scroll-tour-design.md` (tick off resolved open items)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: no new API; a reviewed, shippable page.

- [ ] **Step 1: Create the landing build config, then run the full test + syntax + production-build gate**

First create `marketing/landing-prototype/vite.build.mjs` (root is `marketing` because `index.html` references its assets with absolute `/landing-prototype/` URLs; output goes to the gitignored `dist/`):

```js
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Landing-only production build. Invoked exclusively via `--config`, so the
// `vite marketing` dev server never auto-loads it. Root = marketing so the
// index.html's absolute /landing-prototype/ asset URLs resolve.
export default defineConfig({
  root: resolve(import.meta.dirname, ".."),
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
});
```

Run: `npx vitest run marketing/landing-prototype`
Expected: PASS (Task 1's suite green).

Run: `for f in marketing/landing-prototype/src/**/*.js marketing/landing-prototype/src/*.js; do node --check "$f"; done`
Expected: no output. (Per-file syntax only — this does NOT catch ESM import resolution, CSS, or bundling errors, which is why the build gate below is required.)

**Production build gate (authoritative).** Run:

`npx vite build --config marketing/landing-prototype/vite.build.mjs`

Expected: `✓ built` with ~79 modules transformed and CSS + JS emitted, no `Failed to resolve` / CSS / Rollup errors. This is the real "does it bundle" check that `node --check` cannot give.

**Do NOT gate on the root `npm run build`.** That script is `tsc && vite build`, which (a) builds the Tauri app, not the landing, and (b) currently fails on 5 pre-existing TypeScript errors in `src/terminal/search-bar.test.ts` and `src/terminal/tab-manager.test.ts` — unrelated to this work and outside the path-limited commit scope. The landing prototype is plain JS (no `tsc` step), so the scoped Vite build above is the correct and sufficient bundle gate. The `dist/` output is gitignored; do not stage it.

- [ ] **Step 2: Reduced-motion audit**

Enable OS reduce-motion. Reload and walk the whole page: hero aurora frozen, tour chapters still switch (instant, no morph tween), aurora palette snaps per chapter, proof terminal renders finished instantly, reveal blocks all visible, CTA glow/sweep off, closing blooms + footer glow frozen, window shown resolved. Fix any element that stays hidden or keeps animating.

- [ ] **Step 3: Keyboard + a11y check**

Tab through the closing band and footer: Download / demo / GitHub / Releases / Issues / License must all be reachable and show a visible focus ring; the demo `button` opens the shared dialog and returns focus on close. Confirm the tour's decorative regions are `aria-hidden` and the rail chapter buttons are real `<button>`s.

- [ ] **Step 4: Performance sanity**

Confirm only TWO WebGL contexts exist (hero + tour aurora), the tour aurora pauses when scrolled offscreen (IntersectionObserver in `aurora.js`), and the closing blooms are CSS-only. In devtools Performance, a scroll through the tour should hold ~60fps with no long tasks from the scroll handler (it is rAF-throttled).

- [ ] **Step 5: Full-page eye-review, both locales, mobile + desktop**

Review hero → tour (3 chapters) → closing band → footer at desktop and ~390px, in EN and VI. Confirm the page reads as one designed system, not stacked sections. Note any polish the reviewer wants; fix in place.

- [ ] **Step 6: Update the spec's open items**

In `docs/superpowers/specs/2026-07-23-landing-scroll-tour-design.md`, mark the entrance animation, mobile fallback, copy finalization, and token extraction as done (leave any genuinely-deferred item noted).

- [ ] **Step 7: Commit**

```bash
git add marketing/landing-prototype
git commit -m "chore(landing): harden pass — reduced-motion, a11y, perf review"
```

---

## Self-Review

**Spec coverage:**
- Scroll-driven three-chapter tour, no wheel hijack → Task 1 (logic) + existing mount. ✓
- Real `.a-appwin` chrome + live transcripts + sidebar ring/dot + `⌘E` → already shipped (commit 704340d); verified in Task 7. ✓
- Per-chapter aurora palette → shipped (2204711); reduced-motion snap verified Task 7. ✓
- Closing band: proof terminal + reveal + CTA polish → shipped (01b0765); a11y/perf in Task 7. ✓
- Colored moving background + footer → shipped (e62f97a); tokens/mobile/a11y in Tasks 4/6/7. ✓
- Open item: window entrance scale-in → Task 3. ✓
- Open item: finalize copy → Task 5. ✓
- Open item: mobile static fallback → Task 4. ✓
- Open item: shared-token extraction → Task 6. ✓
- English-only inside window → enforced in Task 2 + verified Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; test steps include real assertions and expected pass/fail. ✓

**Type/name consistency:** `chapterForProgress` / `trackProgress` / `CHAPTER_COUNT` are defined in Task 1 and consumed by the same names in Tasks 1/4. `mountWindowEntrance`, `mountResponsiveMode`, `.tour--static`, `data-enter`, `.is-entered` are defined and consumed consistently. `AGENTS` keys (`claude`/`codex`/`opencode`) align board (Task 2) with the rendered panes. Token names (`--accent`, `--accent-rgb`, `--font-display`, `--font-mono`, `--sg-*`) match between `tokens.css` (Task 6) and both consumers. ✓

**Review blockers resolved (verified against the current code):**
- **TDZ crash on desktop mount** — `mountResponsiveMode`'s synchronous `apply()` → `update()` assigns `rafId`, so Task 4 now wires the helper *after* `let rafId = null;` (replacing the standalone initial `update();`), not before it. ✓
- **Narrow-screen CSS defeated by specificity** — forcing `data-chapter="3"` activates `(0,3,0)` chapter-3 rules; Task 4's static overrides now use `.tour.tour--static` `(0,3,0)` (wins on source order), explicitly un-hide `.tour__chaptext span`, and un-lock the `.a-appwin` `aspect-ratio` + `overflow` so the stacked board/grid are not clipped. ✓
- **Copy task could edit the locked hero** — Task 5 now names the in-scope tour/finale/footer keys and freezes the 8 hero/shared keys (`headlineLead`, `headlineTail`, `subhead`, `primaryCta`, `secondaryCta`, `navProduct`, `navGithub`, `localeLabel`); it is a verify-and-fix-specific-defects step, not an open rewrite. ✓
- **No production build gate** — Task 7 adds `marketing/landing-prototype/vite.build.mjs` and gates on `npx vite build --config …` (verified: 79 modules, CSS+JS emitted). Root `npm run build` is explicitly NOT the gate (builds the Tauri app; fails on 5 pre-existing `src/terminal/*.test.ts` TS errors outside this scope). ✓
