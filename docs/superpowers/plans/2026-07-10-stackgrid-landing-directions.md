# Stackgrid Landing Direction Specimens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build five radically different bilingual HTML hero specimens so the user can shortlist Stackgrid's visual direction by eye.

**Architecture:** Add a static ES-module prototype under `marketing/landing-prototype/`, served by the repository's existing Vite dependency with `marketing/` as its isolated root. A small review controller owns URL state, locale selection, keyboard cycling, the floating switcher, and one shared accessible demo dialog; each direction owns independent markup, lifecycle hooks, and namespaced CSS so structural divergence is preserved. Task 1 creates runnable direction stubs before later tasks replace them, keeping dependency order executable. This plan stops after visual handoff and does not build the Preact round.

**Tech Stack:** Static HTML, CSS, browser ES modules, existing Vite 6, existing Stackgrid WebM/MP4/poster assets, Playwright MCP for rendered review.

## Global Constraints

- This is throwaway direction code, not production landing-page code.
- Keep hero copy, product sequence, and CTA hierarchy identical in all five directions.
- Primary CTA: `Watch the 45-sec demo`; secondary CTA: `View on GitHub`.
- Every primary CTA opens the shared native `<dialog>` containing the real Focus Expand
  video; every secondary CTA links to `https://github.com/mxrsv/stackgrid`.
- Resolve English/Vietnamese from the system locale; `?lang=en|vi` always overrides it.
- Use `?direction=A` through `?direction=E`; left/right arrow keys cycle unless an input, textarea, select, button, link, or contenteditable element owns focus.
- Desktop and mobile must be separately composed, not proportionally scaled.
- Motion is cinematic but controlled; support `prefers-reduced-motion`.
- Use `marketing/stackgrid-cmd-e-poster.png`, list WebM before MP4, and do not require WebGL.
- No analytics, persistence, network data, product mutations, or claims for unevidenced features.
- Do not use purple blobs, empty centered headline heroes, three-card feature grids, nested cards, stock buttons, or stock navigation.
- Do not add automated tests: the attached prototype contract explicitly calls for a fast throwaway with browser verification instead.
- Do not create git commits unless the user separately requests them.

## File map

- Modify `package.json` — add the single prototype launch command.
- Create `marketing/landing-prototype/index.html` — isolated document shell, metadata, prototype warning, app mount points.
- Create `marketing/landing-prototype/styles/base.css` — reset, shared accessibility primitives, review-safe defaults.
- Create `marketing/landing-prototype/styles/review-switcher.css` — floating review controls only.
- Create `marketing/landing-prototype/styles/direction-a.css` — Agent Mission Control.
- Create `marketing/landing-prototype/styles/direction-b.css` — Native Spatial Studio.
- Create `marketing/landing-prototype/styles/direction-c.css` — Operator's Field Manual.
- Create `marketing/landing-prototype/styles/direction-d.css` — Signal Chamber.
- Create `marketing/landing-prototype/styles/direction-e.css` — Precision CRT.
- Create `marketing/landing-prototype/src/copy.js` — bilingual shared content and locale resolution.
- Create `marketing/landing-prototype/src/review-state.js` — URL state and direction cycling.
- Create `marketing/landing-prototype/src/review-switcher.js` — accessible floating review UI.
- Create `marketing/landing-prototype/src/product-stage.js` — evidenced process/CWD data,
  shared three-step narrative labels, and accessible demo-dialog behavior, not shared layout.
- Create `marketing/landing-prototype/src/directions/a.js` through `e.js` — independent hero markup.
- Create `marketing/landing-prototype/src/main.js` — direction dispatch, rerender, language control.

---

### Task 1: Isolated review surface and controller

**Files:**
- Modify: `package.json:6-12`
- Create: `marketing/landing-prototype/index.html`
- Create: `marketing/landing-prototype/styles/base.css`
- Create: `marketing/landing-prototype/styles/review-switcher.css`
- Create: `marketing/landing-prototype/styles/direction-a.css`
- Create: `marketing/landing-prototype/styles/direction-b.css`
- Create: `marketing/landing-prototype/styles/direction-c.css`
- Create: `marketing/landing-prototype/styles/direction-d.css`
- Create: `marketing/landing-prototype/styles/direction-e.css`
- Create: `marketing/landing-prototype/src/copy.js`
- Create: `marketing/landing-prototype/src/review-state.js`
- Create: `marketing/landing-prototype/src/review-switcher.js`
- Create: `marketing/landing-prototype/src/directions/a.js`
- Create: `marketing/landing-prototype/src/directions/b.js`
- Create: `marketing/landing-prototype/src/directions/c.js`
- Create: `marketing/landing-prototype/src/directions/d.js`
- Create: `marketing/landing-prototype/src/directions/e.js`
- Create: `marketing/landing-prototype/src/main.js`

**Interfaces:**
- Produces `DIRECTIONS = ["A", "B", "C", "D", "E"]`.
- Produces `resolveLocale(search: string, navigatorLanguage: string): "en" | "vi"`.
- Produces `readReviewState(location: Location): { direction: string; locale: "en" | "vi" }`.
- Produces `replaceReviewState(patch: { direction?: string; locale?: "en" | "vi" }): void`.
- Produces `cycleDirection(current: string, step: -1 | 1): string`.
- Produces `mountReviewSwitcher(host, state, callbacks): () => void`.
- Produces five runnable stubs with the shared signature
  `renderDirectionX(copy): { markup: string; mount(root: HTMLElement): () => void }`.
- Consumes renderers through `renderers[direction](messages)` and disposes the prior
  renderer before mounting another.

- [ ] **Step 1: Add the one-command Vite entry**

Add this script without changing the production `dev` command:

```json
"prototype:landing": "vite marketing --host 127.0.0.1 --port 5173 --strictPort --open /landing-prototype/"
```

- [ ] **Step 2: Create the isolated HTML shell**

The document must include:

```html
<meta name="robots" content="noindex,nofollow" />
<link rel="stylesheet" href="/landing-prototype/styles/base.css" />
<link rel="stylesheet" href="/landing-prototype/styles/review-switcher.css" />
<main id="specimen-root"></main>
<div id="review-root"></div>
<div id="demo-root"></div>
<script type="module" src="/landing-prototype/src/main.js"></script>
```

Set a `data-prototype="landing-direction"` attribute on `<html>` and include a
visually-hidden “PROTOTYPE — THROW AWAY AFTER DIRECTION PICK” notice for maintainers.

- [ ] **Step 3: Define the shared bilingual content**

`copy.js` must export one object with identical keys for `en` and `vi`:

```js
export const messages = {
  en: {
    navProduct: "Stackgrid",
    navGithub: "GitHub",
    eyebrow: "A native macOS terminal for AI agent CLIs",
    headlineLead: "Run the grid.",
    headlineTail: "Keep every agent in sight.",
    subhead:
      "Stackgrid is a native macOS terminal built to launch, watch, and steer AI coding agents in parallel.",
    primaryCta: "Watch the 45-sec demo",
    secondaryCta: "View on GitHub",
    stagePreset: "Preset",
    stageWorkspace: "agent-workspace",
    stageFocus: "Focus 65%",
    sampleSessionLabel: "Sample session",
    localeLabel: "Language",
  },
  vi: {
    navProduct: "Stackgrid",
    navGithub: "GitHub",
    eyebrow: "Terminal macOS native cho các AI agent CLI",
    headlineLead: "Vận hành cả đội hình.",
    headlineTail: "Không agent nào rời khỏi tầm mắt.",
    subhead:
      "Stackgrid là terminal macOS native để khởi chạy, quan sát và điều phối nhiều AI coding agent song song.",
    primaryCta: "Xem demo 45 giây",
    secondaryCta: "Xem trên GitHub",
    stagePreset: "Bố cục",
    stageWorkspace: "agent-workspace",
    stageFocus: "Tập trung 65%",
    sampleSessionLabel: "Phiên minh hoạ",
    localeLabel: "Ngôn ngữ",
  },
};
```

`resolveLocale()` returns the valid query override first, otherwise returns `vi` when
`navigatorLanguage.toLowerCase().startsWith("vi")`, otherwise `en`.

- [ ] **Step 4: Implement shareable review state**

Use `URL` and `history.replaceState`, preserving unrelated query parameters. Invalid
or missing directions resolve to `A`; invalid locales fall back through
`resolveLocale()`. `cycleDirection()` wraps at both ends.

- [ ] **Step 5: Build the floating switcher**

Render previous/next icon buttons, `A — Agent Mission Control` style current label,
five direct direction dots, and EN/VI controls. Give all icon-only controls an
`aria-label`. Keep the switcher visually neutral: near-black pill, white text, compact
mono type, high z-index, and a small `PROTOTYPE` marker so it cannot be mistaken for a
candidate design.

- [ ] **Step 6: Create the Direction A stub and stylesheet**

Create `a.js` and `direction-a.css`. The module exports the final lifecycle signature,
renders the shared copy plus a visible “Direction A — pending treatment” stage, and
returns a no-op disposer:

```js
export function renderDirectionA(copy) {
  return {
    markup: `<section class="direction-a"><h1>${copy.headlineLead} ${copy.headlineTail}</h1></section>`,
    mount() {
      return () => {};
    },
  };
}
```

- [ ] **Step 7: Create the Direction B stub and stylesheet**

Repeat the same final lifecycle contract for `b.js` and `direction-b.css`, with a
Direction B pending-treatment label.

- [ ] **Step 8: Create the Direction C stub and stylesheet**

Repeat the same final lifecycle contract for `c.js` and `direction-c.css`, with a
Direction C pending-treatment label.

- [ ] **Step 9: Create the Direction D stub and stylesheet**

Repeat the same final lifecycle contract for `d.js` and `direction-d.css`, with a
Direction D pending-treatment label.

- [ ] **Step 10: Create the Direction E stub and stylesheet**

Repeat the same final lifecycle contract for `e.js` and `direction-e.css`, with a
Direction E pending-treatment label.

- [ ] **Step 11: Wire keyboard and renderer lifecycle**

`main.js` imports all five direction styles and renderers, writes only the selected
renderer markup into `#specimen-root`, runs its `mount()` hook, disposes that hook before
the next render, mounts the review switcher, and updates the document language. Ignore
left/right cycling while the event target matches:

```js
"input, textarea, select, button, a, [contenteditable='true']"
```

- [ ] **Step 12: Smoke-check the controller**

Run:

```bash
npm run prototype:landing
```

Expected: Vite serves `/landing-prototype/`, the browser opens, `?direction=E&lang=vi`
survives reload, arrow keys wrap E → A and A → E, locale controls update only `lang`,
all five pending-treatment stubs render, and the browser console has no errors.

---

### Task 2: Shared truthful product-stage data

**Files:**
- Create: `marketing/landing-prototype/src/product-stage.js`
- Modify: `marketing/landing-prototype/src/main.js`

**Interfaces:**
- Produces `agentPanes`, a frozen array of four pane records:
  `{ id, agent, process, cwd, lines, accent }`.
- Produces frozen `sequenceSteps` with exactly `preset`, `grid`, and `focus` labels.
- Produces `mountDemoDialog(host: HTMLElement, triggerRoot: HTMLElement): () => void`.
- Consumed by all direction renderers for process badges, CWDs, sample transcript text,
  and sequence labels only.

- [ ] **Step 1: Define four truthful pane records**

Use Claude Code, Codex, Gemini CLI, and Shell. Use only evidenced `process` and `cwd`
metadata; terminal lines are explicitly labeled as a sample session and must be short,
plausible, and non-promissory:

```js
{
  id: "claude",
  agent: "Claude Code",
  process: "claude",
  cwd: "~/work/stackgrid",
  lines: ["Read src/terminal/layout-engine.ts", "Refining split ratio…"],
  accent: "#d9ff70",
}
```

Freeze both the array and records so direction code treats this as display data.
Any direction that renders `lines` must place the localized
`copy.sampleSessionLabel` visibly adjacent to them; directions that do not render
transcript lines do not need the label.

- [ ] **Step 2: Define the shared three-step evidence contract**

Export three records keyed `preset`, `grid`, and `focus`. Every direction must render
exactly one element for each record with `data-sequence-step="<key>"`; the visual form
is direction-owned. Every direction must also render a `<button data-open-demo>` using
the localized primary CTA and an `<a href="https://github.com/mxrsv/stackgrid">` using
the localized secondary CTA. This guarantees evidence and action parity without
sharing layout.

The sequence elements must appear in DOM order `preset`, `grid`, `focus` and carry
visible `01`, `02`, `03` labels. The final focus artifact must use
`data-focus-stage`, one `data-active-pane`, and exactly three `data-secondary-pane`
elements. Along its dominant split axis, the active pane must occupy 62–68% of the
stage while all three secondary panes retain non-zero visible rectangles. Desktop and
mobile may switch the dominant axis, but both must preserve that measurable 65% state.

- [ ] **Step 3: Implement the accessible demo dialog**

`mountDemoDialog()` creates one native `<dialog>` under `#demo-root`. It binds every
`[data-open-demo]` trigger in the current direction, restores focus to the opener on
close, closes on its explicit close button or `Escape`, and returns a disposer for all
listeners that also removes the dialog node. The dialog contains a muted, looped,
playsinline `<video controls>` with:

```html
<video controls muted loop playsinline poster="/stackgrid-cmd-e-poster.png"
  aria-label="Stackgrid Focus Expand demo">
  <source src="/stackgrid-cmd-e.webm" type="video/webm" />
  <source src="/stackgrid-cmd-e.mp4" type="video/mp4" />
  Your browser does not support HTML video.
</video>
```

Only call `video.play()` after the user's CTA click and only when
`prefers-reduced-motion: reduce` does not match. Pause and reset the video when closing.

- [ ] **Step 4: Wire dialog lifecycle into `main.js`**

After inserting renderer markup, mount both the direction lifecycle and demo dialog;
compose their disposers so both are cleaned before direction or locale changes.

---

### Task 3: Direction A — Agent Mission Control

**Files:**
- Modify: `marketing/landing-prototype/src/directions/a.js`
- Modify: `marketing/landing-prototype/styles/direction-a.css`

**Interfaces:**
- Produces `renderDirectionA(copy): { markup: string; mount(root: HTMLElement): () => void }`.
- Consumes `agentPanes` and `sequenceSteps` but owns all layout markup.

- [ ] **Step 1: Build the asymmetric command-center composition**

Use a narrow left rail for product mark/status, a 5-column content grid, and a dominant
PTY field that breaks the right edge. The headline occupies columns 1–2; the stage
occupies columns 2–5 with intentional overlap. Render four edge-to-edge panes with
hairline dividers and one inset active frame. Add crosshair ticks plus evidenced process
badges and CWD annotations instead of a stock square grid. Label terminal lines
the localized `copy.sampleSessionLabel` wherever transcript lines are rendered.

- [ ] **Step 2: Apply authored treatment**

Use graphite surface steps, off-white text, electric-lime only for active signal/CTA/key
data, tight grotesk display type, mono telemetry labels, and hard 2–6px corners. The CTA
gets a directional fill sweep and arrow translation; terminal chrome remains flat.

- [ ] **Step 3: Add restrained motion**

On load, stagger pane signal lines and bring the active frame to 65% over a named
custom cubic-bezier. Keep all copy stable. Reduced motion shows the final state.

- [ ] **Step 4: Verify A at two breakpoints**

Check 1440×1000 and 390×844. Expected: product is identifiable in the first viewport;
the focal remains larger than the copy; mobile reorders to status strip → headline →
stage → CTAs without horizontal overflow.

---

### Task 4: Direction B — Native Spatial Studio

**Files:**
- Modify: `marketing/landing-prototype/src/directions/b.js`
- Modify: `marketing/landing-prototype/styles/direction-b.css`

**Interfaces:**
- Produces `renderDirectionB(copy): { markup: string; mount(root: HTMLElement): () => void }`.
- Consumes `agentPanes` and `sequenceSteps` but owns all layout markup.

- [ ] **Step 1: Build the spatial composition**

Use a warm mineral canvas with an offset typographic column and a perspective stack of
three window planes. The front window shows the four-pane grid; two rear planes suggest
preset and focus states. Avoid a centered device mockup and avoid glass cards floating
without spatial logic.

- [ ] **Step 2: Apply native-material treatment**

Use near-white mineral surfaces, graphite text, cobalt signal, warm shadow colors,
subtle noise, 14–22px outer shells, and crisp inner pane dividers. Controls must feel
machined for this page rather than copied from macOS. Pair a characterful display face
with SF Mono-compatible terminal text.

- [ ] **Step 3: Add depth motion**

Use pointer-safe parallax capped to a few pixels and a single window-plane settle on
entry. Disable both for reduced motion and coarse pointers.

- [ ] **Step 4: Verify B at two breakpoints**

Check 1440×1000 and 390×844. Expected: mobile turns the window stack into a deliberate
vertical crop with one rear plane still visible; CTA and locale controls remain usable;
no text overlaps the spatial focal.

---

### Task 5: Direction C — Operator's Field Manual

**Files:**
- Modify: `marketing/landing-prototype/src/directions/c.js`
- Modify: `marketing/landing-prototype/styles/direction-c.css`

**Interfaces:**
- Produces `renderDirectionC(copy): { markup: string; mount(root: HTMLElement): () => void }`.
- Consumes `agentPanes` and `sequenceSteps` but owns all layout markup.

- [ ] **Step 1: Build the editorial diagram composition**

Use an asymmetrical 12-column paper spread: headline reads like a field-manual cover,
the pane layout becomes an annotated technical plate, and a vertical running index
connects copy to stage. Use callout lines and numbered notes tied to real preset/grid/
focus states, not decorative arrows.

- [ ] **Step 2: Apply print-engineered treatment**

Use warm paper, ink black, vermilion signal, visible registration marks, fine rules,
slightly compressed display type, and mono annotations. Avoid faux-aged texture and
avoid newspaper-column clichés.

- [ ] **Step 3: Add editorial motion**

Reveal the technical plate through a clipped wipe, then draw only the three annotation
leaders. Reduced motion renders all leaders immediately.

- [ ] **Step 4: Verify C at two breakpoints**

Check 1440×1000 and 390×844. Expected: mobile becomes a tall manual cover with the
technical plate spanning edge-to-edge; annotations remain legible and do not form a
dense tangle.

---

### Task 6: Directions D and E — cinematic and instrumentation boundaries

**Files:**
- Modify: `marketing/landing-prototype/src/directions/d.js`
- Modify: `marketing/landing-prototype/styles/direction-d.css`
- Modify: `marketing/landing-prototype/src/directions/e.js`
- Modify: `marketing/landing-prototype/styles/direction-e.css`

**Interfaces:**
- Produces `renderDirectionD(copy): { markup: string; mount(root: HTMLElement): () => void }`.
- Produces `renderDirectionE(copy): { markup: string; mount(root: HTMLElement): () => void }`.
- Both consume `agentPanes` and `sequenceSteps`.

- [ ] **Step 1: Build D as a Signal Chamber**

Seat the product stage low and wide like an instrument on a dark stage. Put copy in an
offset upper-left aperture rather than centered above it. Use CSS radial/conic light
fields tied to the active pane, cyan for system depth, amber for human focus, and
near-black quiet zones. The staged preset → grid → focus artifact acts as the light
source rather than sitting inside a generic browser card; the CTA opens the shared real
video dialog.

- [ ] **Step 2: Motion-test D**

Create one high-signal moment: active focus causes the amber light field and pane frame
to expand together. Do not animate the entire background continuously. Reduced motion
uses the final light state.

- [ ] **Step 3: Build E as Precision CRT**

Compose a left instrument mast, a large cropped terminal field, and a right-aligned
headline lockup. Use phosphor green for system status, amber for focus, dark olive-black
surfaces, calibrated scan masks, waveform ticks, and small labels. Keep scanlines below
readability threshold and do not distort body copy.

- [ ] **Step 4: Motion-test E**

Use a short phosphor warm-up and one scanning focus marker. Do not add random glitches,
flicker, chromatic aberration, or typing loops. Reduced motion starts fully warm.

- [ ] **Step 5: Verify D and E at two breakpoints**

Check 1440×1000 and 390×844. Expected: D remains cinematic without hiding product UI;
E reads as a precise contemporary instrument rather than a novelty terminal theme;
neither direction overflows horizontally.

---

### Task 7: Cross-direction browser review and handoff

**Files:**
- Modify only files from Tasks 1–6 when verification exposes defects.

**Interfaces:**
- Consumes the complete prototype.
- Produces five reviewable URLs and fresh browser evidence.

- [ ] **Step 1: Run repository checks**

Run:

```bash
npm run build
npm test
```

Expected: TypeScript/Vite build passes and the existing Vitest suite passes. The static
prototype must not alter the Tauri app bundle behavior.

- [ ] **Step 2: Inspect all ten visual states**

With the prototype server running, inspect A–E at 1440×1000 and 390×844. For every
state verify: no clipping, no accidental generic card grid, one obvious focal,
functional CTAs, readable EN and VI, visible focus styles, exactly one each of
`[data-sequence-step="preset"]`, `grid`, and `focus` in that DOM order, and no console
errors. In each screenshot, verify visible `01 → 02 → 03` narrative order. Measure the
final `data-focus-stage`: the active pane must occupy 62–68% on the dominant axis and
all three secondary pane rectangles must remain visible at both breakpoints.

- [ ] **Step 3: Verify interaction and accessibility basics**

Keyboard through locale controls, direct direction controls, CTAs, and video control.
Verify arrow cycling is disabled while an interactive element has focus. Emulate
`prefers-reduced-motion: reduce` and confirm all five directions stop decorative
motion while preserving final state.

- [ ] **Step 4: Validate critical contrast pairs**

For each direction, inspect effective foreground/background colors for body copy,
eyebrow, primary CTA, secondary CTA, process badges, and the review switcher. Text must
sit on an opaque underlay or a bounded quiet zone; for gradients, textures, transparency,
and light fields, sample the darkest and lightest effective points behind the glyph
area and use the worst result. Apply the WCAG relative-luminance formula in browser
evaluation: require at least 4.5:1 for normal text and 3:1 for text at least 24px
regular or 18.66px bold. Also require 3:1 against adjacent colors for focus indicators,
control boundaries, and meaningful non-text pane-state graphics. Adjust direction
tokens when any worst-case pair fails.

- [ ] **Step 5: Verify network and media behavior**

Confirm no analytics or unexpected third-party data requests. Verify poster first
paint and that `/stackgrid-cmd-e-poster.png`, `/stackgrid-cmd-e.webm`, and
`/stackgrid-cmd-e.mp4` return successfully under the `marketing/` Vite root. Verify
WebM-first source ordering, MP4 fallback, and no repeated 404s.

- [ ] **Step 6: Present the eye-review surface**

Hand over:

```text
http://127.0.0.1:5173/landing-prototype/?direction=A
http://127.0.0.1:5173/landing-prototype/?direction=B
http://127.0.0.1:5173/landing-prototype/?direction=C
http://127.0.0.1:5173/landing-prototype/?direction=D
http://127.0.0.1:5173/landing-prototype/?direction=E
```

Ask the user to shortlist roughly three directions and identify specific parts worth
combining. Do not rank the designs on the user's behalf and do not begin the Preact
round before this eye-review.
